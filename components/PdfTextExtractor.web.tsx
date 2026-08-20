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

// pdf.js returns a flat list of text fragments positioned by x/y, not
// grouped into lines. Group fragments into lines by y-coordinate so that
// each visual line of the statement becomes one line of text — parseStatement
// matches one transaction per line, so without this every page collapses
// into a single unparseable line.
function pageItemsToText(items: { str: string; transform: number[] }[]): string {
  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const item of items) {
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
      const response = await fetch(uri);
      const data = new Uint8Array(await response.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(pageItemsToText(content.items as { str: string; transform: number[] }[]));
      }
      return pages.join("\n");
    },
  }));

  return null;
});
