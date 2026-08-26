import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AnimatedAmount } from "../components/AnimatedAmount";
import { LineChart } from "../components/LineChart";
import { addAssetBalance, getAllAssetsHistory, getAssetBalances, getAssets, insertAsset } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { ASSET_TYPES, type Asset, type AssetType } from "../lib/types";

// Matches the Summary / Add Transaction / Accounts / Categories / Move
// Transactions screens' design system.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChartDate(date: string): string {
  const [year, m] = date.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

const TYPE_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };
const TYPE_TINT: Record<AssetType, string> = {
  Savings: "#EDE9FE",
  Investment: "#DCFCE7",
  "401k": "#DBEAFE",
  Cash: "#FEF3C7",
};

type AssetWithHistory = Asset & { balance: number; history: number[] };

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <View style={{ width: 40, height: 28 }} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  return (
    <View style={styles.sparkline}>
      {points.map((p, i) => {
        const h = 6 + ((p - min) / range) * 22;
        return <View key={i} style={[styles.sparkBar, { height: h, backgroundColor: color }]} />;
      })}
    </View>
  );
}

function AssetRow({ asset }: { asset: AssetWithHistory }) {
  const first = asset.history[0] ?? asset.balance;
  const delta = asset.balance - first;
  const pct = first !== 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;
  const hasHistory = asset.history.length >= 2;
  const color = up ? "#16A34A" : "#DC2626";

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/asset/[id]", params: { id: String(asset.id) } })}
      style={[styles.assetRow, { backgroundColor: TYPE_TINT[asset.type] }]}
    >
      <View style={[styles.assetIcon, { backgroundColor: neutral.card }]}>
        <Text style={{ fontSize: 16 }}>{TYPE_ICON[asset.type]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.assetName} numberOfLines={1}>
          {asset.name}
        </Text>
        <Text style={styles.assetType}>{asset.type}</Text>
        {hasHistory && (
          <Text style={[styles.assetDelta, { color }]}>
            {up ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%)
          </Text>
        )}
      </View>
      {hasHistory && <Sparkline points={asset.history} color={color} />}
      <AnimatedAmount value={asset.balance} style={styles.assetBalance} />
      <Ionicons name="chevron-forward" size={16} color={neutral.textSecondary} />
    </Pressable>
  );
}

export default function AssetsScreen() {
  const db = useSQLiteContext();
  const [assets, setAssets] = useState<AssetWithHistory[]>([]);
  const [totalHistory, setTotalHistory] = useState<{ date: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AssetType>("Savings");
  const [newBalance, setNewBalance] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
    getAllAssetsHistory(db).then(setTotalHistory);
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
  const totalFirst = assets.reduce((sum, a) => sum + (a.history[0] ?? a.balance), 0);
  const totalDelta = total - totalFirst;
  const totalPct = totalFirst !== 0 ? (totalDelta / totalFirst) * 100 : 0;

  const groups = ASSET_TYPES.map((type) => ({
    type,
    items: assets.filter((a) => a.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={neutral.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Savings & Investments</Text>
          <View style={styles.headerBtn} />
        </View>

        {!loading && assets.length > 0 && (
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={styles.heroLabel}>Total savings & investments</Text>
            <AnimatedAmount value={total} style={styles.heroValue} prefix="$" />
            {totalFirst > 0 && (
              <View style={styles.heroDeltaPill}>
                <Text style={[styles.heroDeltaText, { color: totalDelta >= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                  {totalDelta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(totalDelta))} ({Math.abs(totalPct).toFixed(1)}%)
                </Text>
                <Text style={styles.heroDeltaSub}>Since first entry</Text>
              </View>
            )}
          </LinearGradient>
        )}

        {totalHistory.length >= 2 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Growth over time</Text>
            <LineChart
              points={totalHistory.map((h) => h.total)}
              labels={totalHistory.map((h) => formatChartDate(h.date))}
              color={ACCENT}
              width={320}
            />
          </View>
        )}

        {adding ? (
          <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputText}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Ally Savings"
                placeholderTextColor={neutral.textSecondary}
                autoFocus
              />
            </View>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeGrid}>
              {ASSET_TYPES.map((t) => {
                const active = newType === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setNewType(t)}
                    style={[styles.typeTile, active && styles.typeTileActive]}
                  >
                    <Text style={{ fontSize: 18 }}>{TYPE_ICON[t]}</Text>
                    <Text style={[styles.typeTileText, active && styles.typeTileTextActive]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.fieldLabel}>Current balance</Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={[styles.inputText, { marginLeft: 4 }]}
                value={newBalance}
                onChangeText={setNewBalance}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={neutral.textSecondary}
              />
            </View>
            <View style={styles.addActions}>
              <Pressable onPress={() => setAdding(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleAdd} style={{ flex: 1 }}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={styles.addAccountBtn}>
            <Ionicons name="add-circle" size={20} color={ACCENT} />
            <Text style={styles.addAccountText}>Add account</Text>
          </Pressable>
        )}

        {!loading && assets.length === 0 && !adding && (
          <View style={styles.sectionCard}>
            <Text style={styles.emptyTitle}>Nothing tracked yet</Text>
            <Text style={styles.emptySubtitle}>Add a savings, investment, or 401k account to start tracking it.</Text>
          </View>
        )}

        {groups.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Your accounts</Text>
            {groups.map((group) => {
              const isCollapsed = collapsed[group.type];
              const subtotal = group.items.reduce((sum, a) => sum + a.balance, 0);
              return (
                <View key={group.type} style={{ gap: spacing.sm }}>
                  <Pressable
                    style={styles.groupHeaderRow}
                    onPress={() => setCollapsed((c) => ({ ...c, [group.type]: !c[group.type] }))}
                  >
                    <View style={[styles.groupIcon, { backgroundColor: TYPE_TINT[group.type] }]}>
                      <Text style={{ fontSize: 14 }}>{TYPE_ICON[group.type]}</Text>
                    </View>
                    <Text style={styles.groupHeader}>{group.type}</Text>
                    <AnimatedAmount value={subtotal} style={styles.groupSubtotal} />
                    <Ionicons
                      name={isCollapsed ? "chevron-down" : "chevron-up"}
                      size={16}
                      color={neutral.textSecondary}
                    />
                  </Pressable>
                  {!isCollapsed && group.items.map((a) => <AssetRow key={a.id} asset={a} />)}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.secureRow}>
          <View style={styles.secureIcon}>
            <Ionicons name="shield-checkmark" size={18} color={ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.secureTitle}>Your data is secure</Text>
            <Text style={styles.secureSubtitle}>Everything here stays on this device unless you back it up.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: neutral.textPrimary },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: 4 },
  heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 30, fontWeight: "700", color: "#FFFFFF" },
  heroDeltaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF1A",
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  heroDeltaText: { fontSize: 12, fontWeight: "700" },
  heroDeltaSub: { fontSize: 11, color: "#FFFFFFCC" },
  sectionCard: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: neutral.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: neutral.textSecondary, marginTop: spacing.xs },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: neutral.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: neutral.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { flex: 1, fontSize: 15, color: neutral.textPrimary },
  dollarSign: { fontSize: 15, color: neutral.textSecondary, fontWeight: "600" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeTile: {
    flexGrow: 1,
    flexBasis: "22%",
    alignItems: "center",
    gap: 4,
    backgroundColor: neutral.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: neutral.border,
    paddingVertical: spacing.sm,
  },
  typeTileActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  typeTileText: { fontSize: 11, fontWeight: "600", color: neutral.textSecondary },
  typeTileTextActive: { color: ACCENT },
  addActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: neutral.background,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: neutral.textSecondary },
  saveBtn: { borderRadius: radius.pill, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  addAccountBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: neutral.border,
    borderStyle: "dashed",
    paddingVertical: spacing.md,
  },
  addAccountText: { fontSize: 15, fontWeight: "700", color: ACCENT },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: neutral.textPrimary, textAlign: "center" },
  emptySubtitle: { fontSize: 13, color: neutral.textSecondary, textAlign: "center" },
  groupHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  groupHeader: { flex: 1, fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  groupSubtotal: { fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.chip,
    padding: spacing.sm,
  },
  assetIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  assetName: { fontSize: 13, fontWeight: "700", color: neutral.textPrimary },
  assetType: { fontSize: 11, color: neutral.textSecondary },
  assetDelta: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  assetBalance: { fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  sparkline: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 28 },
  sparkBar: { width: 4, borderRadius: 2 },
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  secureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ACCENT_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  secureTitle: { fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  secureSubtitle: { fontSize: 12, color: neutral.textSecondary, marginTop: 2 },
});
