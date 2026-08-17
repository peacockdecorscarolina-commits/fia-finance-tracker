// Mirrors ../../extraction/categories.ts — kept as a fixed starting list for
// now. Categories live in SQLite (see db.ts) so they can become
// editable/custom later without changing this file's shape.
export const DEFAULT_CATEGORIES = [
  "Groceries",
  "Dining",
  "Transport",
  "Subscriptions",
  "Bills & Utilities",
  "Shopping",
  "Entertainment",
  "Health",
  "Income",
  "Other",
] as const;
