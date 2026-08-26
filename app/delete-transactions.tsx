import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getAccountStyle } from "../lib/accountStyle";
import { deleteTransactions, getAccounts, getTransactions } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";

type Status = { kind: "idle" } | { kind: "done"; count: number };

export default function DeleteTransactionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useFocusEffect(
    useCallback(() => {
      getAccounts(db).then((list) => {
        setAccounts(list);
        setAccountId((current) => current ?? list[0]?.id ?? null);
      });
    }, [db])
  );

  const isValidDateRange = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);

  async function handlePreview() {
    if (accountId === null || !isValidDateRange) return;
    const rows = await getTransactions(db, { accountId, start, end });
    setPreviewCount(rows.length);
    setConfirming(false);
    setStatus({ kind: "idle" });
  }

  async function handleDelete() {
    if (accountId === null || !isValidDateRange) return;
    const count = await deleteTransactions(db, { accountId, start, end });
    setPreviewCount(null);
    setConfirming(false);
    setStatus({ kind: "done", count });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Delete Transactions</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.description}>
          Fix a bad upload (wrong dates, duplicate statement) by removing every transaction on one
          account within a date range, then re-uploading the statement. This can't be undone.
        </Text>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.grid}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              const style = getAccountStyle(a.name);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => {
                    setAccountId(a.id);
                    setPreviewCount(null);
                    setConfirming(false);
                  }}
                  style={[styles.tile, active && styles.tileActive]}
                >
                  <View style={[styles.tileIcon, { backgroundColor: style.color }]}>
                    <Text style={styles.tileIconText}>{a.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.tileLabel, active && styles.tileLabelActive]} numberOfLines={1}>
                    {a.name}
                  </Text>
                  {active && (
                    <View style={styles.checkBadge}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Date range</Text>
          <View style={styles.dateRow}>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={start}
                onChangeText={(v) => {
                  setStart(v);
                  setPreviewCount(null);
                  setConfirming(false);
                }}
                placeholder="2025-12-10"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 6 }]}
              />
            </View>
            <Text style={styles.toText}>to</Text>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={end}
                onChangeText={(v) => {
                  setEnd(v);
                  setPreviewCount(null);
                  setConfirming(false);
                }}
                placeholder="2026-01-09"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 6 }]}
              />
            </View>
          </View>

          <Pressable
            onPress={handlePreview}
            disabled={accountId === null || !isValidDateRange}
            style={[styles.previewBtn, (accountId === null || !isValidDateRange) && { opacity: 0.5 }]}
          >
            <Text style={styles.previewBtnText}>Preview</Text>
          </Pressable>

          {previewCount !== null && (
            <Text style={styles.previewText}>
              {previewCount} transaction{previewCount === 1 ? "" : "s"} match this account and date range.
            </Text>
          )}

          {previewCount !== null && previewCount > 0 && !confirming && (
            <Pressable onPress={() => setConfirming(true)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete {previewCount} transactions</Text>
            </Pressable>
          )}

          {confirming && (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>
                This will permanently delete {previewCount} transaction{previewCount === 1 ? "" : "s"}. This can't
                be undone.
              </Text>
              <View style={styles.confirmRow}>
                <Pressable onPress={() => setConfirming(false)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleDelete} style={[styles.deleteBtn, { flex: 1 }]}>
                  <Text style={styles.deleteBtnText}>Yes, delete</Text>
                </Pressable>
              </View>
            </View>
          )}

          {status.kind === "done" && (
            <Text style={styles.successText}>Deleted {status.count} transactions.</Text>
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
  description: { fontSize: 13, color: colors.textSecondary },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: "31%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tileActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  tileIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  tileIconText: { color: "#FFFFFF", fontSize: 8, fontWeight: "700" },
  tileLabel: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.textPrimary },
  tileLabelActive: { color: ACCENT },
  checkBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  toText: { color: colors.textSecondary, fontWeight: "600" },
  previewBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: ACCENT_LIGHT,
  },
  previewBtnText: { fontSize: 13, fontWeight: "700", color: ACCENT },
  previewText: { fontSize: 13, color: colors.textSecondary },
  deleteBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: DANGER,
  },
  deleteBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  successText: { fontSize: 13, color: "#16A34A", fontWeight: "600" },
  confirmBox: { backgroundColor: DANGER_LIGHT, borderRadius: radius.chip, padding: spacing.md, gap: spacing.sm },
  confirmText: { fontSize: 13, color: DANGER, fontWeight: "600" },
  confirmRow: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  });
}
