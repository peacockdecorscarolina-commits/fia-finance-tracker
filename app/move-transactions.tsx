import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getAccountStyle } from "../lib/accountStyle";
import { getAccounts, getTransactions, moveTransactions } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the Summary / Add Transaction / Accounts screens' design system.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

type Status = { kind: "idle" } | { kind: "error"; message: string } | { kind: "done"; count: number };

export default function MoveTransactionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useFocusEffect(
    useCallback(() => {
      getAccounts(db).then((list) => {
        setAccounts(list);
        setFromId((current) => current ?? list[0]?.id ?? null);
        setToId((current) => current ?? list[1]?.id ?? list[0]?.id ?? null);
      });
    }, [db])
  );

  const isValidDateRange = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);

  async function handlePreview() {
    if (fromId === null || !isValidDateRange) return;
    const rows = await getTransactions(db, { accountId: fromId, start, end });
    setPreviewCount(rows.length);
    setStatus({ kind: "idle" });
  }

  async function handleMove() {
    if (fromId === null || toId === null || !isValidDateRange) return;
    const count = await moveTransactions(db, { fromAccountId: fromId, toAccountId: toId, start, end });
    setPreviewCount(null);
    setStatus({ kind: "done", count });
  }

  function AccountPicker({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number | null;
    onChange: (id: number) => void;
  }) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.grid}>
          {accounts.map((a) => {
            const active = a.id === value;
            const style = getAccountStyle(a.name);
            return (
              <Pressable
                key={a.id}
                onPress={() => onChange(a.id)}
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
    );
  }

  const canMove = previewCount !== null && previewCount > 0 && toId !== null && toId !== fromId;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Move Transactions</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.description}>
          Fix a statement saved to the wrong account: pick the account it's currently on, the account
          it should be on, and the date range to move.
        </Text>

        <View style={styles.sectionCard}>
          <AccountPicker label="From account" value={fromId} onChange={setFromId} />
        </View>

        <View style={styles.sectionCard}>
          <AccountPicker label="To account" value={toId} onChange={setToId} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Date range</Text>
          <View style={styles.dateRow}>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={start}
                onChangeText={setStart}
                placeholder="2026-06-13"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 6 }]}
              />
            </View>
            <Text style={styles.toText}>to</Text>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={end}
                onChangeText={setEnd}
                placeholder="2026-07-09"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 6 }]}
              />
            </View>
          </View>

          <Pressable
            onPress={handlePreview}
            disabled={fromId === null || !isValidDateRange}
            style={[styles.previewBtn, (fromId === null || !isValidDateRange) && { opacity: 0.5 }]}
          >
            <Text style={styles.previewBtnText}>Preview</Text>
          </Pressable>

          {previewCount !== null && (
            <Text style={styles.previewText}>
              {previewCount} transaction{previewCount === 1 ? "" : "s"} match this account and date range.
            </Text>
          )}

          {canMove && (
            <Pressable onPress={handleMove}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
                <Text style={styles.submitText}>Move {previewCount} to selected account</Text>
              </LinearGradient>
            </Pressable>
          )}

          {status.kind === "done" && <Text style={styles.successText}>Moved {status.count} transactions.</Text>}
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
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  description: { fontSize: 13, color: colors.textSecondary },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldLabel: {
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
  submitBtn: { borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  submitText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  successText: { fontSize: 13, color: "#16A34A", fontWeight: "600" },
  });
}
