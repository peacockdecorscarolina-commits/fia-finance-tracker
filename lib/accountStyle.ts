import { fallbackColorFor, hashString } from "./colorHash";

// Visual identity for the "By card" breakdown -- accounts are just credit
// cards/bank accounts (no meaningfully different icon per issuer), so every
// account gets the same card glyph and a color picked deterministically
// from its name, giving each card a consistent, distinguishable color
// without any per-account setup.
export function getAccountStyle(name: string): { emoji: string; color: string } {
  return { emoji: "💳", color: fallbackColorFor(name) };
}

// Deep, clearly different hues for full wallet-card size -- the vivid hash
// colors above are too loud there, and white text stays readable on all of these.
const CARD_COLORS = ["#1E3A8A", "#065F46", "#9A3412", "#9F1239", "#0E7490", "#854D0E", "#5B21B6", "#3F3F46"];

// Hand-picked colors for specific cards, keyed by lowercased account name.
// Kept mid-tone rather than pastel so the card's white text stays readable.
const CARD_COLOR_OVERRIDES: Record<string, string> = {
  "amex blue": "#2C5F9E", // medium-dark blue
  "amex green": "#55A072", // soft sage green
  bilt: "#2E2E33", // charcoal
  "capital one": "#9F1239", // crimson
  "wells fargo checking": "#D9605A", // soft red
};

// Handed out in the order accounts were added (by id) rather than hashed from
// the name, since hashing let several cards land on the same color. Distinct
// for the first CARD_COLORS.length accounts; after that colors repeat.
export function getAccountCardColor(name: string, accounts: { id: number; name: string }[]): string {
  const override = CARD_COLOR_OVERRIDES[name.trim().toLowerCase()];
  if (override) return override;
  const account = accounts.find((a) => a.name === name);
  const index = account
    ? accounts.map((a) => a.id).sort((a, b) => a - b).indexOf(account.id)
    : hashString(name);
  return CARD_COLORS[index % CARD_COLORS.length];
}
