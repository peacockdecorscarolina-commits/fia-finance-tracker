import * as pdfjsLib from "pdfjs-dist";
import { forwardRef, useImperativeHandle } from "react";

// Served from our own origin (public/pdf.worker.min.mjs, copied from
// node_modules/pdfjs-dist/build) rather than a CDN. Safari is stricter than
// Chrome about loading Worker scripts cross-origin and can fail silently or
// throw deep inside pdf.js's fallback path when it can't -- same-origin
// avoids the whole problem, on every browser.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export type PdfTextExtractorHandle = {
  extractText: (uri: string) => Promise<string>;
};

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// pdf.js returns a flat list of text fragments positioned by x/y, not
// grouped into lines. Group fragments into lines by y-coordinate so that
// each visual line of the statement becomes one line of text — parseStatement
// matches one transaction per line, so without this every page collapses
// into a single unparseable line.
function pageItemsToText(items: { str: string; transform: number[] }[]): string {
  if (!Array.isArray(items)) {
    throw new Error(`Expected an array of text items, got ${Object.prototype.toString.call(items)}`);
  }

  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const item of items) {
    // getTextContent() can mix in TextMarkedContent entries (tagging
    // boundaries with no str/transform) alongside real TextItems; skip
    // anything that isn't a real text fragment rather than crashing on it.
    if (!item || typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(currentLine);
      currentLine = item.str;
    } else {
      currentLine += (currentLine ? " " : "") + item.str;
    }
    lastY = y;
  }
  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

// Web build of the PDF text extractor. Unlike the native version, there's
// no WebView needed here — the browser already has the real DOM/Worker
// APIs pdf.js wants, so it runs directly against the file's blob URI.
export const PdfTextExtractor = forwardRef<PdfTextExtractorHandle, object>((_props, ref) => {
  useImperativeHandle(ref, () => ({
    extractText: async (uri: string) => {
      let data: Uint8Array;
      try {
        const response = await fetch(uri);
        data = new Uint8Array(await response.arrayBuffer());
      } catch (err) {
        throw new Error(`Failed to read the selected file: ${describeError(err)}`);
      }

      let doc: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
      try {
        // We only ever read plain text, never render anything -- disabling
        // font/glyph loading avoids a meaningful chunk of memory pdf.js would
        // otherwise spend per page, which matters on a phone-sized tab
        // running this alongside the app's own SQLite/WASM footprint.
        doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
      } catch (err) {
        throw new Error(`Failed to open the PDF: ${describeError(err)}`);
      }

      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        let items: { str: string; transform: number[] }[];
        let page: Awaited<ReturnType<typeof doc.getPage>> | null = null;
        try {
          page = await doc.getPage(i);
          const content = await page.getTextContent();
          items = content.items as { str: string; transform: number[] }[];
        } catch (err) {
          throw new Error(`Failed to read page ${i} of the PDF: ${describeError(err)}`);
        }
        try {
          pages.push(pageItemsToText(items));
        } catch (err) {
          throw new Error(`Failed to process text on page ${i} of the PDF: ${describeError(err)}`);
        } finally {
          // Release this page's resources before moving to the next one,
          // instead of letting them accumulate for the whole document.
          page?.cleanup();
        }
      }
      return pages.join("\n");
    },
  }));

  return null;
});
