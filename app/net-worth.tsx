import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AnimatedAmount } from "../components/AnimatedAmount";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { addAssetBalance, getAssetBalances, getAssets, insertAsset } from "../lib/db";
import { colors, gradientAccent, radius, spacing } from "../lib/theme";
import { ASSET_TYPES, type Asset, type AssetType } from "../lib/types";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TYPE_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };

type AssetWithHistory = Asset & { balance: number; history: number[] };

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <View style={{ width: 40, height: 32 }} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  return (
    <View style={styles.sparkline}>
      {points.map((p, i) => {
        const h = 6 + ((p - min) / range) * 26;
        return <View key={i} style={[styles.sparkBar, { height: h, backgroundColor: color }]} />;
      })}
    </View>
  );
}

function AssetCard({ asset }: { asset: AssetWithHistory }) {
  const first = asset.history[0] ?? asset.balance;
  const delta = asset.balance - first;
  const pct = first !== 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;
  const hasHistory = asset.history.length >= 2;

  return (
    <Pressable onPress={() => router.push({ pathname: "/asset/[id]", params: { id: String(asset.id) } })}>
      <Card style={styles.assetCard}>
        <View style={styles.assetRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.assetName}>
              {TYPE_ICON[asset.type]} {asset.name}
            </Text>
            <Text style={styles.assetType}>{asset.type}</Text>
            {hasHistory && (
              <Text style={[styles.assetDelta, { color: up ? colors.positive : colors.negative }]}>
                {up ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%)
              </Text>
            )}
          </View>
          {hasHistory && <Sparkline points={asset.history} color={up ? colors.positive : colors.negative} />}
        </View>
        <AnimatedAmount value={asset.balance} style={styles.assetBalance} />
      </Card>
    </Pressable>
  );
}

export default function AssetsScreen() {
  const db = useSQLiteContext();
  const [assets, setAssets] = useState<AssetWithHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AssetType>("Savings");
  const [newBalance, setNewBalance] = useState("");

  const load = useCallback(() => {
    getAssets(db).then(async (list) => {
      const withHistory = await Promise.all(
        list.map(async (a) => {
          const entries = await getAssetBalances(db, a.id);
          const history = entries.map((e) => e.balance);
          return { ...a, balance: history[history.length - 1] ?? 0, history };
        })
      );
      setAssets(withHistory);
      setLoading(false);
    });
  }, [db]);

  useFocusEffect(load);

  async function handleAdd() {
    const value = Number(newBalance);
    if (!newName.trim() || !Number.isFinite(value)) return;
    const id = await insertAsset(db, newName.trim(), newType);
    await addAssetBalance(db, id, new Date().toISOString().slice(0, 10), value);
    setAdding(false);
    setNewName("");
    setNewBalance("");
    setNewType("Savings");
    load();
  }

  const total = assets.reduce((sum, a) => sum + a.balance, 0);

  const groups = ASSET_TYPES.map((type) => ({
    type,
    items: assets.filter((a) => a.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <Screen>
      <View style={styles.container}>
        {!loading && assets.length > 0 && (
          <LinearGradient
            colors={gradientAccent}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.netWorthCard}
          >
            <Text style={styles.netWorthLabel}>Total savings & investments</Text>
            <AnimatedAmount value={total} style={styles.netWorthValue} prefix="$" />
          </LinearGradient>
        )}

        {adding ? (
          <Card style={styles.addCard}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Ally Savings"
              placeholderTextColor={colors.textSecondary}
              autoFocus
            />
            <Text style={styles.label}>Type</Text>
            <View style={styles.typeRow}>
              {ASSET_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setNewType(t)}
                  style={[styles.typeChip, newType === t && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, newType === t && styles.typeChipTextActive]}>
                    {TYPE_ICON[t]} {t}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Current balance</Text>
            <TextInput
              style={styles.input}
              value={newBalance}
              onChangeText={setNewBalance}
              keyboardType="decimal-pad"
              placeholder="e.g. 8420.11"
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.addActions}>
              <PillButton title="Cancel" onPress={() => setAdding(false)} variant="secondary" />
              <PillButton title="Save" onPress={handleAdd} />
            </View>
          </Card>
        ) : (
          <PillButton title="+ Add account" onPress={() => setAdding(true)} />
        )}

        {!loading && assets.length === 0 && !adding && (
          <EmptyState
            icon="💰"
            title="Nothing tracked yet"
            subtitle="Add a savings, investment, or 401k account to start tracking it."
          />
        )}

        {groups.map((group) => (
          <View key={group.type} style={styles.group}>
            <View style={styles.groupHeaderRow}>
              <Text style={styles.groupHeader}>
                {TYPE_ICON[group.type]} {group.type}
              </Text>
              <AnimatedAmount
                value={group.items.reduce((sum, a) => sum + a.balance, 0)}
                style={styles.groupSubtotal}
              />
            </View>
            {group.items.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  netWorthCard: { borderRadius: radius.card, padding: spacing.md },
  netWorthLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
  netWorthValue: { fontSize: 26, fontWeight: "700", color: "#FFFFFF", marginTop: 4 },
  group: { gap: spacing.sm },
  groupHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  groupHeader: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  groupSubtotal: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  assetCard: { gap: spacing.xs },
  assetRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  assetName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  assetType: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  assetBalance: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  assetDelta: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  sparkline: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 32 },
  sparkBar: { width: 6, borderRadius: 2 },
  addCard: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.pillActive, borderColor: colors.pillActive },
  typeChipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  typeChipTextActive: { color: colors.pillActiveText },
  addActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
});
