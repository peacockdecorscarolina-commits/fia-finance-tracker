import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { backupToDrive, restoreFromDrive } from "../lib/googleDrive";
import { isSignedIn, signIn, signOut } from "../lib/googleAuth";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";

type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; message: string };

export default function SyncScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
            device's data is ever missing. Only this app can see that file.
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
                <Text style={styles.signedInText}>Signed in with Google</Text>
              </View>

              <Pressable onPress={handleBackup} disabled={busy} style={[styles.primaryBtnWrap, busy && { opacity: 0.5 }]}>
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
  statusRow: { alignItems: "center", paddingVertical: spacing.xs },
  statusText: { fontSize: 13, color: colors.textSecondary },
  errorBox: { backgroundColor: DANGER_LIGHT, borderRadius: radius.chip, padding: spacing.sm },
  errorText: { fontSize: 13, color: DANGER, fontWeight: "600" },
  doneBox: { backgroundColor: "#F0FDF4", borderRadius: radius.chip, padding: spacing.sm },
  doneText: { fontSize: 13, color: "#16A34A", fontWeight: "600" },
  });
}
