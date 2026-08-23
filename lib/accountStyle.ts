import { fallbackColorFor } from "./colorHash";

// Visual identity for the "By card" breakdown -- accounts are just credit
// cards/bank accounts (no meaningfully different icon per issuer), so every
// account gets the same card glyph and a color picked deterministically
// from its name, giving each card a consistent, distinguishable color
// without any per-account setup.
export function getAccountStyle(name: string): { emoji: string; color: string } {
  return { emoji: "💳", color: fallbackColorFor(name) };
}
