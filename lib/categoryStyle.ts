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
  subscriptions: { emoji: "🔁", color: "#7C3AED" },
  income: { emoji: "💰", color: "#16A34A" },
  payment: { emoji: "💳", color: "#0F172A" },
  rent: { emoji: "🏠", color: "#B45309" },
  insurance: { emoji: "🛡️", color: "#0891B2" },
  education: { emoji: "🎓", color: "#2563EB" },
  pets: { emoji: "🐾", color: "#B45309" },
  gifts: { emoji: "🎁", color: "#DB2777" },
  other: { emoji: "🏷️", color: "#64748B" },
};

// Fallback palette for categories not in the table above, picked
// deterministically from the name so a given category always looks the
// same without needing the user to configure anything.
const FALLBACK_COLORS = ["#2563EB", "#DB2777", "#7C3AED", "#EA580C", "#0891B2", "#B45309", "#16A34A", "#DC2626"];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getCategoryStyle(name: string): { emoji: string; color: string } {
  const known = KNOWN[name.trim().toLowerCase()];
  if (known) return known;
  return { emoji: "🏷️", color: FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length] };
}
