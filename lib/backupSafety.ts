// Drive keeps a single backup that each backup replaces, so backing up a
// fresh or wiped device (say, after reinstalling) would swap a good backup
// for an empty one. Before uploading, what's on this device is compared with
// what the backup holds, and a backup that would lose most of it is stopped.

export type BackupSummary = { transactions: number; accounts: number; exportedAt: string };

export function summarizeBackup(snapshot: { transactions: unknown[]; accounts: unknown[]; exportedAt: string }): BackupSummary {
  return { transactions: snapshot.transactions.length, accounts: snapshot.accounts.length, exportedAt: snapshot.exportedAt };
}

// Losing everything, or more than half the transactions, needs a yes from
// the user. Deleting a few transactions on purpose doesn't.
export function backupWouldLoseData(device: BackupSummary, drive: BackupSummary | null): boolean {
  if (!drive) return false;
  if (drive.accounts > 0 && device.accounts === 0) return true;
  if (drive.transactions === 0) return false;
  return device.transactions === 0 || device.transactions < drive.transactions / 2;
}

export class BackupWouldLoseDataError extends Error {
  constructor(public device: BackupSummary, public drive: BackupSummary) {
    super("Your Google Drive backup has more data than this device.");
  }
}
