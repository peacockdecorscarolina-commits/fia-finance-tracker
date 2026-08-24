import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { LineChart } from "../../components/LineChart";
import { PillButton } from "../../components/PillButton";
import { Screen } from "../../components/Screen";
import { addAssetBalance, deleteAssetBalance, getAssetBalances, getAssets } from "../../lib/db";
import { colors, radius, spacing } from "../../lib/theme";
import type { Asset, AssetBalanceEntry, AssetType } from "../../lib/types";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChartDate(date: string): string {
  const [year, m] = date.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

const TYPE_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [entries, setEntries] = useState<AssetBalanceEntry[]>([]);
  const [updating, setUpdating] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [dateInput, setDateInput] = useState(todayISO());

  const load = useCallback(() => {
    const assetId = Number(id);
    getAssets(db).then((list) => setAsset(list.find((a) => a.id === assetId) ?? null));
    getAssetBalances(db, assetId).then((list) => setEntries([...list].reverse()));
  }, [db, id]);

  useFocusEffect(load);

  const currentBalance = entries[0]?.balance ?? 0;

  async function handleUpdate() {
    const value = Number(balanceInput);
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    await addAssetBalance(db, Number(id), dateInput, value);
    setUpdating(false);
    setBalanceInput("");
    load();
  }

  async function handleDeleteEntry(entryId: number) {
    await deleteAssetBalance(db, entryId);
    load();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: asset ? `${TYPE_ICON[asset.type]} ${asset.name}` : "Account" }} />
      <View style={styles.container}>
        <Card style={styles.balanceCard}>
          <Text style={styles.label}>Current balance</Text>
          <Text style={styles.balance}>{formatMoney(currentBalance)}</Text>

          {updating ? (
            <View style={styles.updateForm}>
              <Text style={styles.label}>New balance</Text>
              <TextInput
                style={styles.input}
                value={balanceInput}
                onChangeText={setBalanceInput}
                keyboardType="decimal-pad"
                placeholder="e.g. 8650.00"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
              <Text style={styles.label}>As of date</Text>
              <TextInput
                style={styles.input}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
              />
              <View style={styles.updateActions}>
                <PillButton title="Cancel" onPress={() => setUpdating(false)} variant="secondary" />
                <PillButton title="Save" onPress={handleUpdate} />
              </View>
            </View>
          ) : (
            <PillButton
              title="Update balance"
              onPress={() => {
                setBalanceInput(currentBalance ? String(currentBalance) : "");
                setDateInput(todayISO());
                setUpdating(true);
              }}
            />
          )}
        </Card>

        {entries.length >= 2 ? (
          <Card style={styles.chartCard}>
            <Text style={styles.label}>Balance over time</Text>
            <LineChart
              points={[...entries].reverse().map((e) => e.balance)}
              labels={[...entries].reverse().map((e) => formatChartDate(e.date))}
              color={colors.accent}
              width={320}
            />
          </Card>
        ) : entries.length === 1 ? (
          <Card style={styles.chartHintCard}>
            <Text style={styles.chartHintText}>
              Add one more balance entry (e.g. an earlier date) to see a trend graph here.
            </Text>
          </Card>
        ) : null}

        <Text style={styles.historyTitle}>History</Text>
        {entries.length === 0 ? (
          <EmptyState icon="📈" title="No balance logged yet" subtitle="Tap Update balance to add the first entry." />
        ) : (
          entries.map((e) => (
            <Card key={e.id} style={styles.entryCard}>
              <View style={styles.entryRow}>
                <Text style={styles.entryDate}>{e.date}</Text>
                <Text style={styles.entryBalance}>{formatMoney(e.balance)}</Text>
              </View>
              <Pressable onPress={() => handleDeleteEntry(e.id)}>
                <Text style={styles.deleteLink}>Delete</Text>
              </Pressable>
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  balanceCard: { gap: spacing.sm },
  chartCard: { gap: spacing.sm },
  chartHintCard: {},
  chartHintText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  balance: { fontSize: 26, fontWeight: "700", color: colors.textPrimary },
  updateForm: { gap: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
  },
  updateActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  historyTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  entryCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  entryDate: { fontSize: 13, color: colors.textSecondary },
  entryBalance: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  deleteLink: { fontSize: 12, color: colors.negative, fontWeight: "600" },
});
