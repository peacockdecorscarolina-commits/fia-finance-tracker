// Vercel serverless function (plain Node.js). Extracts plain text from an
// uploaded PDF statement server-side instead of running pdf.js in the
// browser. This exists because pdf.js in-browser hit a persistent,
// unreproducible failure on one specific phone's Safari (a "for...of"
// TypeError deep inside pdf.js's own getTextContent(), surviving every fix
// tried and even a Private Browsing tab) that couldn't be diagnosed further
// without direct device access. Node.js is a single, controlled JS engine,
// which sidesteps the whole class of browser-engine-specific quirks.

// pdf.js returns a flat list of text fragments positioned by x/y, not
// grouped into lines. Group fragments into lines by y-coordinate so each
// visual line of the statement becomes one line of text -- parseStatement
// (client-side) matches one transaction per line.
function pageItemsToText(items) {
  const lines = [];
  let currentLine = "";
  let lastY = null;
  for (const item of items) {
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { pdfBase64 } = req.body || {};
  if (!pdfBase64) {
    res.status(400).json({ error: "Missing pdfBase64" });
    return;
  }

  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(Buffer.from(pdfBase64, "base64"));
    const doc = await pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        pages.push(pageItemsToText(content.items));
      } finally {
        page.cleanup();
      }
    }

    res.status(200).json({ text: pages.join("\n") });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
};
