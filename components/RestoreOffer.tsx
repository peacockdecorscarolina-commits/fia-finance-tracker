import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { isReadOnly } from "../lib/access";
import { markDriveSynced } from "../lib/autoBackup";
import type { BackupSummary } from "../lib/backupSafety";
import { getSetting, setSetting } from "../lib/db";
import { getDriveBackupInfo, restoreFromDrive } from "../lib/googleDrive";
import { isSignedIn } from "../lib/googleAuth";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
// Answered once per device: restored, or chose to start fresh.
const ANSWERED_KEY = "restore_offer_answered";

// On a device with nothing in it yet (a new phone, Fia re-added to the Home
// Screen), offers to bring back the Google Drive backup -- instead of the
// person having to know it lives under Sync.
export function RestoreOffer() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [backup, setBackup] = useState<BackupSummary | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (Platform.OS !== "web" || !isSignedIn() || isReadOnly()) return;
        if ((await getSetting(db, ANSWERED_KEY)) !== null) return;
        const row = await db.getFirstAsync<{ accounts: number; transactions: number }>(
          "SELECT (SELECT COUNT(*) FROM accounts) as accounts, (SELECT COUNT(*) FROM transactions) as transactions"
        );
        if (!row || row.accounts > 0 || row.transactions > 0) return;
        const info = await getDriveBackupInfo().catch(() => null);
        if (!cancelled && info && (info.accounts > 0 || info.transactions > 0)) setBackup(info);
      })();
      return () => {
        cancelled = true;
      };
    }, [db])
  );

  if (!backup) return null;

  async function restore() {
    setState("busy");
    try {
      await restoreFromDrive(db);
      await markDriveSynced(db);
      await setSetting(db, ANSWERED_KEY, "restored");
      // Every screen reloads with the restored data.
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  async function startFresh() {
    await setSetting(db, ANSWERED_KEY, "fresh");
    setBackup(null);
  }

  const date = backup.exportedAt
    ? new Date(backup.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.icon}>
          <Ionicons name="cloud-download-outline" size={18} color={ACCENT} />
        </View>
        <Text style={styles.title}>Welcome back! Restore your data?</Text>
      </View>
      <Text style={styles.text}>
        Your Google Drive has a Fia backup{date ? ` from ${date}` : ""}: {backup.transactions.toLocaleString()} transactions
        across {backup.accounts} account{backup.accounts === 1 ? "" : "s"}.
      </Text>
      {state === "error" && <Text style={styles.error}>{"Couldn't restore it. Check your connection and try again."}</Text>}
      <View style={styles.actions}>
        <Pressable onPress={restore} disabled={state === "busy"} style={styles.primary}>
          {state === "busy" ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>Restore my data</Text>
          )}
        </Pressable>
        <Pressable onPress={startFresh} disabled={state === "busy"} style={styles.secondary}>
          <Text style={styles.secondaryText}>Start fresh</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1.5,
      borderColor: "#BFDBFE",
      padding: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
    title: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
    error: { fontSize: 13, color: "#DC2626", fontWeight: "600" },
    actions: { flexDirection: "row", gap: spacing.sm },
    primary: {
      flex: 1,
      backgroundColor: ACCENT,
      borderRadius: radius.pill,
      paddingVertical: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    secondary: { borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: spacing.md, backgroundColor: colors.background },
    secondaryText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  });
}
