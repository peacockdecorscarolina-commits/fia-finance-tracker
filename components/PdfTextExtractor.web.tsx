import * as pdfjsLib from "pdfjs-dist";
import { forwardRef, useImperativeHandle } from "react";

// Pinned to match the version installed in package.json.
const PDFJS_VERSION = "6.2.108";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export type PdfTextExtractorHandle = {
  extractText: (uri: string) => Promise<string>;
};

// Web build of the PDF text extractor. Unlike the native version, there's
// no WebView needed here — the browser already has the real DOM/Worker
// APIs pdf.js wants, so it runs directly against the file's blob URI.
export const PdfTextExtractor = forwardRef<PdfTextExtractorHandle, object>((_props, ref) => {
  useImperativeHandle(ref, () => ({
    extractText: async (uri: string) => {
      const response = await fetch(uri);
      const data = new Uint8Array(await response.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data }).promise;
      let text = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
      }
      return text;
    },
  }));

  return null;
});
