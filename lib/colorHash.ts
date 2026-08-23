// Shared by categoryStyle/accountStyle: picks a deterministic color from a
// name so free-text entries (custom categories, custom account names) get a
// consistent color without the user configuring anything.
export const FALLBACK_COLORS = ["#2563EB", "#DB2777", "#7C3AED", "#EA580C", "#0891B2", "#B45309", "#16A34A", "#DC2626"];

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function fallbackColorFor(name: string): string {
  return FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length];
}
