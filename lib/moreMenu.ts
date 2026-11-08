// The ⋯ menu's three layouts and the little status labels on its items.

export type MenuLayout = "list" | "tiles" | "grid";
export const MENU_LAYOUTS: { value: MenuLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "tiles", label: "Tiles" },
  { value: "grid", label: "Grid" },
];
export const MENU_LAYOUT_KEY = "menu_layout";
export const DEFAULT_MENU_LAYOUT: MenuLayout = "tiles";

export function parseMenuLayout(value: string | null): MenuLayout {
  return value === "list" || value === "tiles" || value === "grid" ? value : DEFAULT_MENU_LAYOUT;
}

export type BadgeTone = "purple" | "amber" | "neutral" | "green" | "red";

// `text` for the list and tiles; `short` fits a grid icon's corner.
export type MenuBadge = { text: string; short: string; tone: BadgeTone };

// A backup over this old shows in red.
export const BACKUP_STALE_DAYS = 3;

export function backupBadge(lastSync: string | null, now = Date.now()): MenuBadge {
  if (!lastSync) return { text: "Not backed up", short: "!", tone: "red" };
  const minutes = Math.max(0, Math.floor((now - new Date(lastSync).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const tone: BadgeTone = days >= BACKUP_STALE_DAYS ? "red" : "green";
  if (minutes < 1) return { text: "Backed up just now", short: "✓", tone };
  if (hours < 1) return { text: `Backed up ${minutes}m ago`, short: `${minutes}m`, tone };
  if (days < 1) return { text: `Backed up ${hours}h ago`, short: `${hours}h`, tone };
  return { text: `Backed up ${days}d ago`, short: `${days}d`, tone };
}

export function countBadge(count: number, tone: BadgeTone = "neutral"): MenuBadge | null {
  return count > 0 ? { text: String(count), short: count > 99 ? "99+" : String(count), tone } : null;
}
