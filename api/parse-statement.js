// Vercel serverless function (plain Node.js). Extracts plain text from an
// uploaded PDF statement server-side instead of running pdf.js in the
// browser. This exists because pdf.js in-browser hit a persistent,
// unreproducible failure on one specific phone's Safari (a "for...of"
// TypeError deep inside pdf.js's own getTextContent(), surviving every fix
// tried and even a Private Browsing tab) that couldn't be diagnosed further
// without direct device access. Node.js is a single, controlled JS engine,
// which sidesteps the whole class of browser-engine-specific quirks.

// pdf.js's legacy Node.js path tries to polyfill DOMMatrix/Path2D from the
// optional "@napi-rs/canvas" package, but only warns (doesn't throw) if
// that package isn't installed -- so text extraction proceeds until some
// PDF actually needs one of those APIs internally (seemingly for certain
// coordinate-transform content, not something every PDF hits), then fails
// with a bare "DOMMatrix is not defined". Rather than pull in a native
// canvas dependency (a real risk on a serverless platform), this provides
// just enough of the DOMMatrix surface pdf.js's own code actually calls
// (constructed from a 6-element matrix array, read via .a-.f, multiplied,
// inverted) -- confirmed by grep across the bundled library, not guessed.
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrix {
    constructor(init) {
      if (Array.isArray(init) || (init && typeof init.length === "number")) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init && typeof init === "object") {
        this.a = init.a ?? 1;
        this.b = init.b ?? 0;
        this.c = init.c ?? 0;
        this.d = init.d ?? 1;
        this.e = init.e ?? 0;
        this.f = init.f ?? 0;
      } else {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }
    multiply(o) {
      return new DOMMatrix([
        this.a * o.a + this.c * o.b,
        this.b * o.a + this.d * o.b,
        this.a * o.c + this.c * o.d,
        this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e,
        this.b * o.e + this.d * o.f + this.f,
      ]);
    }
    invertSelf() {
      const det = this.a * this.d - this.b * this.c;
      const a = this.d / det;
      const b = -this.b / det;
      const c = -this.c / det;
      const d = this.a / det;
      const e = -(a * this.e + c * this.f);
      const f = -(b * this.e + d * this.f);
      this.a = a;
      this.b = b;
      this.c = c;
      this.d = d;
      this.e = e;
      this.f = f;
      return this;
    }
  }
  globalThis.DOMMatrix = DOMMatrix;
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {};
}

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
