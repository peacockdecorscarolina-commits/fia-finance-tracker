import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { deleteTransactions, getAccounts, getTransactions } from "../lib/db";
import { colors, radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";

type Status = { kind: "idle" } | { kind: "done"; count: number };

export default function DeleteTransactionsScreen() {
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
    <Screen>
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>Delete Transactions</Text>
          <Text style={styles.description}>
            Fix a bad upload (wrong dates, duplicate statement) by removing every transaction on
            one account within a date range, then re-uploading the statement. This can't be
            undone.
          </Text>

          <Text style={styles.label}>Account</Text>
          <View style={styles.chipRow}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => {
                    setAccountId(a.id);
                    setPreviewCount(null);
                    setConfirming(false);
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Date range</Text>
          <View style={styles.dateRow}>
            <TextInput
              value={start}
              onChangeText={(v) => {
                setStart(v);
                setPreviewCount(null);
                setConfirming(false);
              }}
              placeholder="2025-12-10"
              placeholderTextColor={colors.textSecondary}
              style={styles.dateInput}
            />
            <Text style={styles.toText}>to</Text>
            <TextInput
              value={end}
              onChangeText={(v) => {
                setEnd(v);
                setPreviewCount(null);
                setConfirming(false);
              }}
              placeholder="2026-01-09"
              placeholderTextColor={colors.textSecondary}
              style={styles.dateInput}
            />
          </View>

          <PillButton
            title="Preview"
            onPress={handlePreview}
            disabled={accountId === null || !isValidDateRange}
            variant="secondary"
          />

          {previewCount !== null && (
            <Text style={styles.previewText}>
              {previewCount} transaction{previewCount === 1 ? "" : "s"} match this account and date
              range.
            </Text>
          )}

          {previewCount !== null && previewCount > 0 && !confirming && (
            <PillButton title={`Delete ${previewCount} transactions`} onPress={() => setConfirming(true)} variant="danger" />
          )}

          {confirming && (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>
                This will permanently delete {previewCount} transaction
                {previewCount === 1 ? "" : "s"}. This can't be undone.
              </Text>
              <View style={styles.confirmRow}>
                <PillButton title="Cancel" onPress={() => setConfirming(false)} variant="secondary" />
                <PillButton title="Yes, delete" onPress={handleDelete} variant="danger" />
              </View>
            </View>
          )}

          {status.kind === "done" && (
            <Text style={styles.successText}>Deleted {status.count} transactions.</Text>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  card: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  description: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.pillActive, borderColor: colors.pillActive },
  chipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: colors.pillActiveText },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateInput: {
    flex: 1,
    backgroundColor: colors.cardSolid,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
  },
  toText: { color: colors.textSecondary, fontWeight: "600" },
  previewText: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.xs },
  successText: { fontSize: 13, color: colors.positive, marginTop: spacing.xs },
  confirmBox: {
    backgroundColor: colors.negativeBg,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmText: { fontSize: 13, color: colors.negative, fontWeight: "600" },
  confirmRow: { flexDirection: "row", gap: spacing.sm },
});
