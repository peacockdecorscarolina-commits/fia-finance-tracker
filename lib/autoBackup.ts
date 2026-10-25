import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import { getSetting, setSetting } from "./db";
import { isSignedIn } from "./googleAuth";
import { backupToDrive } from "./googleDrive";

// Browser storage can be wiped (Safari clears sites that go unopened for
// about a week unless they're on the Home Screen), so Drive backups happen
// on their own: after a statement or transaction is saved, and on app open
// when the last one is over a day old.
//
// Only on a device that has already backed up or restored by hand. A fresh
// or wiped device that signs in would otherwise overwrite a good Drive
// backup with its own empty data before the user gets a chance to restore.
const LAST_SYNC_KEY = "last_drive_sync_at";
const STALE_MS = 24 * 60 * 60 * 1000;

let inFlight: Promise<void> | null = null;

// Call after any manual backup or restore succeeds -- this is what opts the
// device in to automatic backups.
export async function markDriveSynced(db: SQLiteDatabase) {
  await setSetting(db, LAST_SYNC_KEY, new Date().toISOString());
}

// Manual backup (header button / Sync screen). Throws, so callers can show errors.
export function backupNow(db: SQLiteDatabase): Promise<void> {
  if (!inFlight) {
    inFlight = backupToDrive(db)
      .then(() => markDriveSynced(db))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function canAutoBackup(db: SQLiteDatabase): Promise<boolean> {
  if (Platform.OS !== "web" || !isSignedIn()) return false;
  return (await getSetting(db, LAST_SYNC_KEY)) !== null;
}

// Fire-and-forget: failures stay silent here; the header button and Sync
// screen are where backup errors get shown.
export async function autoBackup(db: SQLiteDatabase) {
  if (!(await canAutoBackup(db))) return;
  backupNow(db).catch(() => {});
}

export async function autoBackupIfStale(db: SQLiteDatabase) {
  if (!(await canAutoBackup(db))) return;
  const last = await getSetting(db, LAST_SYNC_KEY);
  if (last && Date.now() - new Date(last).getTime() < STALE_MS) return;
  backupNow(db).catch(() => {});
}
