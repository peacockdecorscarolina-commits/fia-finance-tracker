import { forwardRef, useImperativeHandle } from "react";

export type PdfTextExtractorHandle = {
  extractText: (uri: string) => Promise<string>;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read the selected file."));
    reader.onloadend = () => {
      // reader.result is "data:application/pdf;base64,<data>" -- strip the prefix.
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

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
      let pdfBase64: string;
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        pdfBase64 = await blobToBase64(blob);
      } catch (err) {
        throw new Error(
          `Failed to read the selected file: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const res = await fetch("/api/parse-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process the PDF.");
      }
      return data.text as string;
    },
  }));

  return null;
});
