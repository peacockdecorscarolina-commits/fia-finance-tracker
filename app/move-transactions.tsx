import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { getAccounts, getTransactions, moveTransactions } from "../lib/db";
import { colors, radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";

type Status = { kind: "idle" } | { kind: "error"; message: string } | { kind: "done"; count: number };

export default function MoveTransactionsScreen() {
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
      <>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.chipRow}>
          {accounts.map((a) => {
            const active = a.id === value;
            return (
              <Pressable
                key={a.id}
                onPress={() => onChange(a.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>Move Transactions</Text>
          <Text style={styles.description}>
            Fix a statement saved to the wrong account: pick the account it's currently on, the
            account it should be on, and the date range to move.
          </Text>

          <AccountPicker label="From account" value={fromId} onChange={setFromId} />
          <AccountPicker label="To account" value={toId} onChange={setToId} />

          <Text style={styles.label}>Date range</Text>
          <View style={styles.dateRow}>
            <TextInput
              value={start}
              onChangeText={setStart}
              placeholder="2026-06-13"
              placeholderTextColor={colors.textSecondary}
              style={styles.dateInput}
            />
            <Text style={styles.toText}>to</Text>
            <TextInput
              value={end}
              onChangeText={setEnd}
              placeholder="2026-07-09"
              placeholderTextColor={colors.textSecondary}
              style={styles.dateInput}
            />
          </View>

          <PillButton
            title="Preview"
            onPress={handlePreview}
            disabled={fromId === null || !isValidDateRange}
            variant="secondary"
          />

          {previewCount !== null && (
            <Text style={styles.previewText}>
              {previewCount} transaction{previewCount === 1 ? "" : "s"} match this account and date
              range.
            </Text>
          )}

          {previewCount !== null && previewCount > 0 && toId !== null && toId !== fromId && (
            <PillButton title={`Move ${previewCount} to selected account`} onPress={handleMove} />
          )}

          {status.kind === "done" && (
            <Text style={styles.successText}>Moved {status.count} transactions.</Text>
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
});
