import { mix } from "./color";
import { fallbackColorFor } from "./colorHash";

// Visual identity for the "By card" breakdown -- accounts are just credit
// cards/bank accounts (no meaningfully different icon per issuer), so every
// account gets the same card glyph and a color picked deterministically
// from its name, giving each card a consistent, distinguishable color
// without any per-account setup.
export function getAccountStyle(name: string): { emoji: string; color: string } {
  return { emoji: "💳", color: fallbackColorFor(name) };
}

// The vivid hash color above reads fine at chip/badge size, but is
// overwhelming at full wallet-card size -- blending it toward a deep slate
// keeps the same per-account identity while giving it a muted, premium feel.
export function getAccountCardColor(name: string): string {
  return mix(fallbackColorFor(name), "#0F172A", 0.65);
}
