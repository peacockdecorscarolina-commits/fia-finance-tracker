// pdfjs-dist bundles a core-js polyfill for the "Iterator Helpers" proposal
// that assumes the global `Iterator` constructor already exists before
// conditionally patching methods onto its prototype, e.g.
// `"function"!=typeof Iterator.prototype.join && (Iterator.prototype.join = ...)`.
// On Safari versions that don't yet have `Iterator` as a global, that throws
// "ReferenceError: Can't find variable: Iterator" immediately on import,
// before any of our own code even runs. A bare-minimum stub here -- imported
// before pdfjs-dist -- lets those guarded checks resolve safely instead;
// core-js's own polyfill logic fills in the actual methods from there.
if (typeof (globalThis as any).Iterator === "undefined") {
  (globalThis as any).Iterator = function Iterator() {};
  (globalThis as any).Iterator.prototype = {};
}

export {};
