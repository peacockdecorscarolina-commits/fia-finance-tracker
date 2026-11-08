import { forwardRef, useImperativeHandle } from "react";
import { getValidAccessToken } from "../lib/googleAuth";

export type PdfTextExtractorHandle = {
  extractText: (uri: string) => Promise<string>;
};

// Vercel turns away requests over about 4.5 MB; this leaves room to spare.
export const MAX_PDF_BYTES = 4.3 * 1024 * 1024;

// Web build of the PDF text extractor. Text extraction runs server-side
// (api/parse-statement.js, plain Node.js) rather than in the browser --
// pdf.js running client-side hit a persistent, unreproducible failure on
// one specific phone's Safari that survived every browser-side fix tried,
// including in a Private Browsing tab (ruling out caching). Node.js is a
// single controlled JS engine, avoiding that whole class of per-device
// browser-engine quirks. The phone just uploads the raw file and gets text
// back.
export const PdfTextExtractor = forwardRef<PdfTextExtractorHandle, object>((_props, ref) => {
  useImperativeHandle(ref, () => ({
    extractText: async (uri: string) => {
      let blob: Blob;
      try {
        const response = await fetch(uri);
        blob = await response.blob();
      } catch (err) {
        throw new Error(
          `Failed to read the selected file: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (blob.size > MAX_PDF_BYTES) {
        const mb = (blob.size / (1024 * 1024)).toFixed(1);
        throw new Error(
          `This PDF is ${mb} MB, and Fia reads PDFs up to 4 MB. Try your bank's CSV download instead, or download the statement again without images.`
        );
      }

      // The raw file, not base64 (a third bigger), so larger PDFs fit. The
      // server reads statements only for people signed in to Fia.
      const res = await fetch("/api/parse-statement", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${await getValidAccessToken().catch(() => "")}`,
        },
        body: blob,
      });
      if (res.status === 413) {
        throw new Error("This PDF is too big for Fia to read (over 4 MB). Try your bank's CSV download instead.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to process the PDF.");
      }
      return data.text as string;
    },
  }));

  return null;
});
