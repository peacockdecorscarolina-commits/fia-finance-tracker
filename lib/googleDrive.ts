import type { SQLiteDatabase } from "expo-sqlite";
import { exportAllData, replaceAllData, type DataSnapshot } from "./db";
import { getValidAccessToken } from "./googleAuth";

const BACKUP_FILENAME = "fia-backup.json";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

async function findBackupFileId(accessToken: string): Promise<string | null> {
  const url = `${DRIVE_FILES_URL}?spaces=appDataFolder&q=${encodeURIComponent(
    `name='${BACKUP_FILENAME}'`
  )}&fields=files(id)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Failed to look up backup file on Drive");
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
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

export async function backupToDrive(db: SQLiteDatabase): Promise<void> {
  const accessToken = await getValidAccessToken();
  const snapshot = await exportAllData(db);
  const content = JSON.stringify(snapshot);
  const boundary = "fia-backup-boundary";

  const existingId = await findBackupFileId(accessToken);
  const isCreate = existingId === null;
  const metadata = isCreate
    ? { name: BACKUP_FILENAME, parents: ["appDataFolder"] }
    : {};
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

export async function restoreFromDrive(db: SQLiteDatabase): Promise<{ exportedAt: string }> {
  const accessToken = await getValidAccessToken();
  const fileId = await findBackupFileId(accessToken);
  if (!fileId) throw new Error("No backup found in Drive yet");

  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to download backup from Drive");

  const snapshot = (await res.json()) as DataSnapshot;
  await replaceAllData(db, snapshot);
  return { exportedAt: snapshot.exportedAt };
}
