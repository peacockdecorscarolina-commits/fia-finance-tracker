import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { backupToDrive, restoreFromDrive } from "../lib/googleDrive";
import { isSignedIn, signIn, signOut } from "../lib/googleAuth";
import { colors, spacing } from "../lib/theme";

type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; message: string };

export default function SyncScreen() {
  const db = useSQLiteContext();
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    setSignedIn(isSignedIn());
  }, []);

  async function handleSignIn() {
    setStatus({ kind: "busy", label: "Redirecting to Google..." });
    await signIn(db);
  }

  function handleSignOut() {
    signOut();
    setSignedIn(false);
    setStatus({ kind: "idle" });
  }

  async function handleBackup() {
    setStatus({ kind: "busy", label: "Backing up..." });
    try {
      await backupToDrive(db);
      setStatus({ kind: "done", message: "Backed up to Google Drive." });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Backup failed." });
    }
  }

  async function handleRestore() {
    setStatus({ kind: "busy", label: "Restoring..." });
    try {
      const { exportedAt } = await restoreFromDrive(db);
      setStatus({
        kind: "done",
        message: `Restored backup from ${new Date(exportedAt).toLocaleString()}.`,
      });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Restore failed." });
    }
  }

  const busy = status.kind === "busy";

  return (
    <Screen>
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>Google Drive Sync</Text>
          <Text style={styles.description}>
            Back up your data to a hidden file in your own Google Drive, and restore it if this
            device's data is ever missing. Only this app can see that file.
          </Text>

          {!signedIn ? (
            <PillButton title="Sign in with Google" onPress={handleSignIn} disabled={busy} />
          ) : (
            <>
              <PillButton title="Back up now" onPress={handleBackup} disabled={busy} />
              <PillButton title="Restore from Drive" onPress={handleRestore} disabled={busy} variant="danger" />
              <PillButton title="Sign out" onPress={handleSignOut} disabled={busy} variant="secondary" />
            </>
          )}

          {status.kind === "busy" && <Text style={styles.statusText}>{status.label}</Text>}
          {status.kind === "error" && <Text style={styles.errorText}>{status.message}</Text>}
          {status.kind === "done" && <Text style={styles.successText}>{status.message}</Text>}
        </Card>

        <PillButton
          title="Back to Home"
          onPress={() => router.replace("/")}
          variant="secondary"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  card: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  description: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  statusText: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.xs },
  errorText: { fontSize: 13, color: colors.negative, marginTop: spacing.xs },
  successText: { fontSize: 13, color: colors.positive, marginTop: spacing.xs },
});
