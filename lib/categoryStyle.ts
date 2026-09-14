import { fallbackColorFor } from "./colorHash";

// Visual identity (emoji + color) for category chips/breakdowns. Categories
// are free-text (users can rename/add their own), so this is a best-effort
// lookup for common names with a deterministic fallback for anything else --
// no per-category setup required from the user.
const KNOWN: Record<string, { emoji: string; color: string }> = {
  groceries: { emoji: "🛒", color: "#16A34A" },
  dining: { emoji: "🍽️", color: "#EA580C" },
  restaurants: { emoji: "🍽️", color: "#EA580C" },
  transport: { emoji: "🚗", color: "#2563EB" },
  transportation: { emoji: "🚗", color: "#2563EB" },
  gas: { emoji: "⛽", color: "#2563EB" },
  "bills & utilities": { emoji: "🧾", color: "#64748B" },
  bills: { emoji: "🧾", color: "#64748B" },
  utilities: { emoji: "🧾", color: "#64748B" },
  shopping: { emoji: "🛍️", color: "#DB2777" },
  entertainment: { emoji: "🎬", color: "#7C3AED" },
  health: { emoji: "💊", color: "#DC2626" },
  fitness: { emoji: "💪", color: "#DC2626" },
  travel: { emoji: "✈️", color: "#0891B2" },
  flight: { emoji: "✈️", color: "#0891B2" },
  flights: { emoji: "✈️", color: "#0891B2" },
  takeout: { emoji: "🍟", color: "#EA580C" },
  "take out": { emoji: "🍟", color: "#EA580C" },
  "take-out": { emoji: "🍟", color: "#EA580C" },
  subscriptions: { emoji: "🔁", color: "#7C3AED" },
  income: { emoji: "💰", color: "#16A34A" },
  payment: { emoji: "💳", color: "#0F172A" },
  rent: { emoji: "🏠", color: "#B45309" },
  insurance: { emoji: "🛡️", color: "#0891B2" },
  education: { emoji: "🎓", color: "#2563EB" },
  pets: { emoji: "🐾", color: "#B45309" },
  gifts: { emoji: "🎁", color: "#DB2777" },
  lodging: { emoji: "🏨", color: "#0891B2" },
  hotel: { emoji: "🏨", color: "#0891B2" },
  hotels: { emoji: "🏨", color: "#0891B2" },
  "car payment": { emoji: "🏎️", color: "#B45309" },
  cash: { emoji: "💵", color: "#16A34A" },
  other: { emoji: "❗", color: "#64748B" },
};

// User-chosen emoji overrides, keyed by normalized category name. Populated
// from the categories table on app start (see initDatabase) and kept in
// sync as the user adds/edits categories, so getCategoryStyle can stay a
// plain synchronous function every call site already relies on.
const emojiOverrides = new Map<string, string>();

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function loadCategoryEmojiOverrides(rows: { name: string; emoji: string }[]) {
  emojiOverrides.clear();
  for (const row of rows) emojiOverrides.set(normalize(row.name), row.emoji);
}

export function setCategoryEmojiOverride(name: string, emoji: string | null | undefined) {
  if (emoji) emojiOverrides.set(normalize(name), emoji);
  else emojiOverrides.delete(normalize(name));
}

export function getCategoryStyle(name: string): { emoji: string; color: string } {
  const color = KNOWN[normalize(name)]?.color ?? fallbackColorFor(name);
  const override = emojiOverrides.get(normalize(name));
  if (override) return { emoji: override, color };
  const known = KNOWN[normalize(name)];
  if (known) return known;
  return { emoji: "🏷️", color };
}
