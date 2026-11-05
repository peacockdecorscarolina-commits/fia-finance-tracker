import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { cachedEmail, requestAccessCheck } from "../lib/access";
import { backupNow, markDriveSynced } from "../lib/autoBackup";
import { BackupWouldLoseDataError, type BackupSummary } from "../lib/backupSafety";
import { restoreFromDrive } from "../lib/googleDrive";
import { isSignedIn, signIn, signOut } from "../lib/googleAuth";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";
const WARNING = "#B45309";

type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; message: string };

export default function SyncScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Set when a backup was stopped because Drive holds much more than this
  // device -- the header button sends its numbers here as params.
  const params = useLocalSearchParams<{
    driveTransactions?: string;
    driveAccounts?: string;
    driveDate?: string;
    deviceTransactions?: string;
    deviceAccounts?: string;
  }>();
  const [warning, setWarning] = useState<{ device: BackupSummary; drive: BackupSummary } | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    cachedEmail(db).then(setEmail);
  }, [db]);

  useEffect(() => {
    setSignedIn(isSignedIn());
    if (params.driveTransactions !== undefined) {
      setWarning({
        drive: {
          transactions: Number(params.driveTransactions),
          accounts: Number(params.driveAccounts ?? 0),
          exportedAt: params.driveDate ?? "",
        },
        device: {
          transactions: Number(params.deviceTransactions ?? 0),
          accounts: Number(params.deviceAccounts ?? 0),
          exportedAt: "",
        },
      });
    }
  }, [params.driveTransactions, params.driveAccounts, params.driveDate, params.deviceTransactions, params.deviceAccounts]);

  async function handleSignIn() {
    setStatus({ kind: "busy", label: "Redirecting to Google..." });
    await signIn(db);
  }

  // Fia needs a Google sign-in to use, so signing out goes back to the
  // sign-in screen. The data on this device stays.
  function handleSignOut() {
    signOut();
    setSignedIn(false);
    setStatus({ kind: "idle" });
    requestAccessCheck();
  }

  async function handleBackup(replaceAnyway = false) {
    setStatus({ kind: "busy", label: "Backing up..." });
    try {
      await backupNow(db, replaceAnyway);
      setWarning(null);
      setStatus({ kind: "done", message: "Backed up to Google Drive." });
    } catch (err) {
      if (err instanceof BackupWouldLoseDataError) {
        setWarning({ device: err.device, drive: err.drive });
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Backup failed." });
    }
  }

  function handleReplaceAnyway() {
    const ok = window.confirm(
      "Replace your Google Drive backup with what's on this device? The data only in the backup will be gone for good."
    );
    if (ok) handleBackup(true);
  }

  async function handleRestore() {
    setStatus({ kind: "busy", label: "Restoring..." });
    try {
      const { exportedAt } = await restoreFromDrive(db);
      await markDriveSynced(db);
      setWarning(null);
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Google Drive Sync</Text>
          <View style={styles.headerBtn} />
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="cloud-outline" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.heroText}>
            Back up your data to a hidden file in your own Google Drive, and restore it if this
            device's data is ever missing. Only this app can see that file. After your first backup
            or restore here, the app also backs up on its own whenever you add transactions.
          </Text>
        </LinearGradient>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account</Text>

          {!signedIn ? (
            <Pressable onPress={handleSignIn} disabled={busy} style={[styles.primaryBtnWrap, busy && { opacity: 0.5 }]}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Ionicons name="logo-google" size={16} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Sign in with Google</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <>
              <View style={styles.signedInRow}>
                <View style={styles.signedInIcon}>
                  <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
                </View>
                <Text style={styles.signedInText}>{email ? `Signed in as ${email}` : "Signed in with Google"}</Text>
              </View>

              <Pressable onPress={() => handleBackup()} disabled={busy} style={[styles.primaryBtnWrap, busy && { opacity: 0.5 }]}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                  <Ionicons name="cloud-upload-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Back up now</Text>
                </LinearGradient>
              </Pressable>

              <Pressable onPress={handleRestore} disabled={busy} style={[styles.dangerBtn, busy && { opacity: 0.5 }]}>
                <Ionicons name="cloud-download-outline" size={16} color={DANGER} />
                <Text style={styles.dangerBtnText}>Restore from Drive</Text>
              </Pressable>

              <Pressable onPress={handleSignOut} disabled={busy} style={[styles.secondaryBtn, busy && { opacity: 0.5 }]}>
                <Text style={styles.secondaryBtnText}>Sign out</Text>
              </Pressable>
            </>
          )}

          {warning && (
            <View style={styles.warningBox}>
              <View style={styles.warningTitleRow}>
                <Ionicons name="warning-outline" size={18} color={WARNING} />
                <Text style={styles.warningTitle}>Your Google Drive backup has more data than this device</Text>
              </View>
              <Text style={styles.warningText}>
                Drive: {warning.drive.transactions.toLocaleString()} transactions, {warning.drive.accounts} accounts
                {warning.drive.exportedAt ? ` (${new Date(warning.drive.exportedAt).toLocaleDateString()})` : ""}
                {"\n"}This device: {warning.device.transactions.toLocaleString()} transactions, {warning.device.accounts} accounts
              </Text>
              <Text style={styles.warningText}>
                Backing up now would replace it. If you just reinstalled Fia or switched devices, restore it instead.
              </Text>
              <Pressable onPress={handleRestore} disabled={busy} style={[styles.primaryBtnWrap, busy && { opacity: 0.5 }]}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                  <Ionicons name="cloud-download-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Restore it instead</Text>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={handleReplaceAnyway} disabled={busy} style={styles.replaceLink}>
                <Text style={styles.replaceLinkText}>Replace anyway</Text>
              </Pressable>
            </View>
          )}

          {status.kind === "busy" && (
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>{status.label}</Text>
            </View>
          )}
          {status.kind === "error" && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{status.message}</Text>
            </View>
          )}
          {status.kind === "done" && (
            <View style={styles.doneBox}>
              <Text style={styles.doneText}>{status.message}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: { fontSize: 13, color: "#FFFFFFE6", lineHeight: 19 },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  signedInRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: radius.chip,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  signedInIcon: { alignItems: "center", justifyContent: "center" },
  signedInText: { fontSize: 13, fontWeight: "600", color: "#16A34A" },
  primaryBtnWrap: { borderRadius: radius.pill, overflow: "hidden" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: DANGER_LIGHT,
  },
  dangerBtnText: { fontSize: 14, fontWeight: "700", color: DANGER },
  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  warningBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: "#FDE68A",
    backgroundColor: colors.background,
  },
  warningTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  warningTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  warningText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  replaceLink: { alignSelf: "center", paddingVertical: spacing.xs },
  replaceLinkText: { fontSize: 13, fontWeight: "600", color: DANGER },
  statusRow: { alignItems: "center", paddingVertical: spacing.xs },
  statusText: { fontSize: 13, color: colors.textSecondary },
  errorBox: { backgroundColor: DANGER_LIGHT, borderRadius: radius.chip, padding: spacing.sm },
  errorText: { fontSize: 13, color: DANGER, fontWeight: "600" },
  doneBox: { backgroundColor: "#F0FDF4", borderRadius: radius.chip, padding: spacing.sm },
  doneText: { fontSize: 13, color: "#16A34A", fontWeight: "600" },
  });
}
