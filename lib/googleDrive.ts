import type { SQLiteDatabase } from "expo-sqlite";
import { BackupWouldLoseDataError, backupWouldLoseData, summarizeBackup, type BackupSummary } from "./backupSafety";
import { exportAllData, replaceAllData, type DataSnapshot } from "./db";
import { getValidAccessToken } from "./googleAuth";

const BACKUP_FILENAME = "fia-backup.json";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

type BackupFile = { id: string; appProperties?: Record<string, string> };

async function findBackupFile(accessToken: string): Promise<BackupFile | null> {
  const url = `${DRIVE_FILES_URL}?spaces=appDataFolder&q=${encodeURIComponent(
    `name='${BACKUP_FILENAME}'`
  )}&fields=files(id,appProperties)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Failed to look up backup file on Drive");
  const data = await res.json();
  return data.files?.[0] ?? null;
}

async function downloadBackup(accessToken: string, fileId: string): Promise<DataSnapshot> {
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to download backup from Drive");
  return (await res.json()) as DataSnapshot;
}

// What the Drive backup holds. Each backup writes its counts onto the file
// (appProperties), so this is one small request; a backup from before that
// gets downloaded and counted instead.
async function driveBackupSummary(accessToken: string, file: BackupFile): Promise<BackupSummary> {
  const props = file.appProperties;
  if (props?.transactions !== undefined && props.accounts !== undefined) {
    return { transactions: Number(props.transactions), accounts: Number(props.accounts), exportedAt: props.exportedAt ?? "" };
  }
  return summarizeBackup(await downloadBackup(accessToken, file.id));
}

function buildMultipartBody(metadata: object, content: string, boundary: string): string {
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  return (
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    content +
    closeDelim
  );
}

// Throws BackupWouldLoseDataError instead of uploading when this device has
// much less than the backup -- unless `replaceAnyway`, after the user said so.
export async function backupToDrive(db: SQLiteDatabase, replaceAnyway = false): Promise<void> {
  const accessToken = await getValidAccessToken();
  const snapshot = await exportAllData(db);
  const content = JSON.stringify(snapshot);
  const boundary = "fia-backup-boundary";
  const device = summarizeBackup(snapshot);

  const existing = await findBackupFile(accessToken);
  const existingId = existing?.id ?? null;
  if (existing && !replaceAnyway) {
    const drive = await driveBackupSummary(accessToken, existing);
    if (backupWouldLoseData(device, drive)) throw new BackupWouldLoseDataError(device, drive);
  }
  const isCreate = existingId === null;
  const appProperties = {
    transactions: String(device.transactions),
    accounts: String(device.accounts),
    exportedAt: device.exportedAt,
  };
  const metadata = isCreate
    ? { name: BACKUP_FILENAME, parents: ["appDataFolder"], appProperties }
    : { appProperties };
  const url = isCreate
    ? `${DRIVE_UPLOAD_URL}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}/${existingId}?uploadType=multipart`;

  const res = await fetch(url, {
    method: isCreate ? "POST" : "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary="${boundary}"`,
    },
    body: buildMultipartBody(metadata, content, boundary),
  });
  if (!res.ok) throw new Error("Failed to upload backup to Drive");
}

// What the Drive backup holds (counts and date), or null when there's none
// -- for offering a restore without downloading the whole thing.
export async function getDriveBackupInfo(): Promise<BackupSummary | null> {
  const accessToken = await getValidAccessToken();
  const file = await findBackupFile(accessToken);
  return file ? driveBackupSummary(accessToken, file) : null;
}

export async function restoreFromDrive(db: SQLiteDatabase): Promise<{ exportedAt: string }> {
  const accessToken = await getValidAccessToken();
  const file = await findBackupFile(accessToken);
  if (!file) throw new Error("No backup found in Drive yet");

  const snapshot = await downloadBackup(accessToken, file.id);
  await replaceAllData(db, snapshot);
  return { exportedAt: snapshot.exportedAt };
}
