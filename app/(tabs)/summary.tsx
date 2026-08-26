import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { EmptyState } from "../../components/EmptyState";
import { getAccountStyle } from "../../lib/accountStyle";
import { getCategoryStyle } from "../../lib/categoryStyle";
import {
  getAccountSummary,
  getAssetSummaries,
  getAssetTypeHistory,
  getCategorySummary,
  getNeedsReviewCount,
  getPaymentTotal,
  getTransactions,
  type AccountTotal,
  type CategoryTotal,
} from "../../lib/db";
import { monthRange } from "../../lib/period";
import { radius, spacing, tabBarClearance } from "../../lib/theme";
import { ASSET_TYPES, type AssetType, type Transaction } from "../../lib/types";

const NET_WORTH_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };
const NET_WORTH_TINT: Record<AssetType, string> = {
  Savings: "#EDE9FE",
  Investment: "#DCFCE7",
  "401k": "#DBEAFE",
  Cash: "#FEF3C7",
};

const HERO_GRADIENT = ["#4C1D95", "#312E81"] as const;

// Neutral iOS-system-style palette for this screen -- a flat colorful
// background (the app's usual blue/mint gradient) reads as "web" rather
// than native; real iOS apps (Wallet, Banking, Health) keep the base
// neutral and save color for the content itself.
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

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function recentMonths(from: string, count: number): string[] {
  const list: string[] = [];
  let m = from;
  for (let i = 0; i < count; i++) {
    list.push(m);
    m = shiftMonth(m, -1);
  }
  return list;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Donut({ slices, total }: { slices: { name: string; value: number; color: string }[]; total: number }) {
  let cumulative = 0;
  const stops = slices.map((s) => {
    const startPct = (cumulative / total) * 100;
    cumulative += s.value;
    const endPct = (cumulative / total) * 100;
    return `${s.color} ${startPct}% ${endPct}%`;
  });
  const gradient = `conic-gradient(${stops.join(", ")})`;
  return (
    <View style={[styles.donut, { backgroundImage: gradient } as object]}>
      <View style={styles.donutHole}>
        <Text style={styles.donutValue}>{formatMoney(total)}</Text>
        <Text style={styles.donutLabel}>Total</Text>
      </View>
    </View>
  );
}

type MoreItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };

function MoreSheet({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: MoreItem[] }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>More tools</Text>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={styles.sheetRow}
            >
              <View style={styles.sheetIconWrap}>
                <Ionicons name={item.icon} size={20} color={neutral.textPrimary} />
              </View>
              <Text style={styles.sheetRowLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={neutral.textSecondary} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function SummaryScreen() {
  const db = useSQLiteContext();
  const [month, setMonth] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [accountTotals, setAccountTotals] = useState<AccountTotal[]>([]);
  const [prevTotal, setPrevTotal] = useState(0);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<{ id: number; name: string; type: AssetType; balance: number }[]>([]);
  const [assetHistories, setAssetHistories] = useState<Record<AssetType, { date: string; total: number }[]>>(
    {} as Record<AssetType, { date: string; total: number }[]>
  );

  useFocusEffect(
    useCallback(() => {
      getNeedsReviewCount(db).then(setReviewCount);
      getAssetSummaries(db).then(setAssets);
      Promise.all(ASSET_TYPES.map((type) => getAssetTypeHistory(db, type).then((history) => [type, history] as const))).then(
        (entries) => setAssetHistories(Object.fromEntries(entries) as Record<AssetType, { date: string; total: number }[]>)
      );
      if (month === null) {
        setMonth(currentMonth());
        return;
      }
      setLoading(true);
      const prevMonth = shiftMonth(month, -1);
      const { start, end } = monthRange(month);
      Promise.all([
        getCategorySummary(db, month).then(setCategoryTotals),
        getAccountSummary(db, month).then(setAccountTotals),
        getCategorySummary(db, prevMonth).then((rows) => setPrevTotal(rows.reduce((sum, r) => sum + r.total, 0))),
        getPaymentTotal(db, month).then(setPaymentTotal),
        getTransactions(db, { start, end }).then((list) => setRecent(list.slice(0, 5))),
      ]).then(() => setLoading(false));
    }, [db, month])
  );

  if (month === null) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const total = categoryTotals.reduce((sum, c) => sum + c.total, 0);
  const pctChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
  const remaining = Math.max(total - paymentTotal, 0);
  const accountMax = Math.max(...accountTotals.map((a) => a.total), 1);

  const moreItems: MoreItem[] = [
    { icon: "card-outline", label: "Accounts", onPress: () => router.push("/accounts") },
    { icon: "pricetag-outline", label: "Categories", onPress: () => router.push("/categories") },
    { icon: "trending-up-outline", label: "Savings & Investments", onPress: () => router.push("/net-worth") },
    { icon: "swap-horizontal-outline", label: "Move", onPress: () => router.push("/move-transactions") },
    { icon: "trash-outline", label: "Delete", onPress: () => router.push("/delete-transactions") },
    ...(Platform.OS === "web"
      ? [
          { icon: "cloud-outline" as const, label: "Sync", onPress: () => router.push("/sync") },
          {
            icon: "refresh-outline" as const,
            label: "Refresh App",
            onPress: () => {
              window.location.href = `${window.location.pathname}?refreshed=${Date.now()}`;
            },
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greetingSmall}>{greeting()},</Text>
            <Text style={styles.greetingName}>Zaighum 👋</Text>
          </View>
          <View style={styles.headerIcons}>
            <Pressable onPress={() => setMoreOpen(true)} style={styles.headerIconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color={neutral.textPrimary} />
            </Pressable>
            <Pressable onPress={() => router.push("/review")} style={styles.headerIconBtn}>
              <Ionicons name="notifications-outline" size={20} color={neutral.textPrimary} />
              {reviewCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeCount}>{reviewCount > 9 ? "9+" : reviewCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.monthPill}>
          <Text style={styles.monthPillText}>📅 {formatMonthLabel(month)}</Text>
          <Text style={styles.monthPillChevron}>{pickerOpen ? "▲" : "▼"}</Text>
        </Pressable>

        {pickerOpen && (
          <ScrollView style={styles.monthDropdown} nestedScrollEnabled>
            {recentMonths(currentMonth(), 12).map((m) => (
              <Pressable
                key={m}
                style={[styles.monthOption, m === month && styles.monthOptionActive]}
                onPress={() => {
                  setMonth(m);
                  setPickerOpen(false);
                }}
              >
                <Text style={[styles.monthOptionText, m === month && styles.monthOptionTextActive]}>
                  {formatMonthLabel(m)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <LinearGradient colors={HERO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroLabel}>Total spent</Text>
              <Text style={styles.heroValue}>{formatMoney(total)}</Text>
              {prevTotal > 0 && (
                <Text style={[styles.heroDelta, { color: pctChange <= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                  {pctChange <= 0 ? "▼" : "▲"} {Math.abs(pctChange).toFixed(1)}% from last month
                </Text>
              )}
            </View>
            <View style={styles.heroDivider} />
            <View>
              <Text style={styles.heroLabel}>Total paid</Text>
              <Text style={styles.heroValueSm}>{formatMoney(paymentTotal)}</Text>
            </View>
          </View>
          <View style={styles.heroBottomRow}>
            <View>
              <Text style={styles.heroLabel}>Remaining to pay</Text>
              <Text style={styles.heroValueSm}>{formatMoney(remaining)}</Text>
            </View>
            <View style={styles.heroIcon}>
              <Text style={{ fontSize: 20 }}>💳</Text>
            </View>
          </View>
        </LinearGradient>

        {ASSET_TYPES.filter((type) => assets.some((a) => a.type === type)).map((type) => {
          const history = assetHistories[type] ?? [];
          const totalForType = assets.filter((a) => a.type === type).reduce((sum, a) => sum + a.balance, 0);
          const first = history[0]?.total ?? totalForType;
          const delta = totalForType - first;
          const pct = first !== 0 ? (delta / first) * 100 : 0;
          return (
            <Pressable key={type} style={styles.assetCard} onPress={() => router.push("/net-worth")}>
              <View style={[styles.assetCardIcon, { backgroundColor: NET_WORTH_TINT[type] }]}>
                <Text style={{ fontSize: 16 }}>{NET_WORTH_ICON[type]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.assetCardLabel}>{type}</Text>
                <Text style={styles.assetCardValue}>{formatMoney(totalForType)}</Text>
              </View>
              {history.length >= 2 && (
                <Text style={[styles.assetCardDelta, { color: delta >= 0 ? "#16A34A" : "#DC2626" }]}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                </Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={neutral.textSecondary} />
            </Pressable>
          );
        })}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>By account</Text>
          {loading ? null : accountTotals.length === 0 ? (
            <EmptyState icon="📊" title="Nothing here yet" subtitle="No spending recorded on any card this month." />
          ) : (
            accountTotals.map((a) => {
              const style = getAccountStyle(a.accountName);
              const pct = (a.total / accountMax) * 100;
              const share = total > 0 ? (a.total / total) * 100 : 0;
              return (
                <Pressable
                  key={a.accountName}
                  style={styles.accountRow}
                  onPress={() => router.push({ pathname: "/account/[name]", params: { name: a.accountName, month } })}
                >
                  <View style={[styles.badge, { backgroundColor: style.color }]}>
                    <Text style={styles.badgeText}>{a.accountName.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.accountTopRow}>
                      <Text style={styles.accountName}>{a.accountName}</Text>
                      <AnimatedAmount value={a.total} style={styles.accountAmount} />
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: style.color }]} />
                    </View>
                  </View>
                  <Text style={[styles.accountPct, { color: style.color }]}>{share.toFixed(1)}%</Text>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>By category</Text>
          {loading ? null : categoryTotals.length === 0 ? (
            <EmptyState icon="📊" title="Nothing here yet" subtitle="No spending recorded for this month." />
          ) : (
            <View style={styles.categoryRow}>
              <Donut
                total={total}
                slices={categoryTotals.map((c) => ({
                  name: c.categoryName,
                  value: c.total,
                  color: getCategoryStyle(c.categoryName).color,
                }))}
              />
              <View style={styles.legend}>
                {categoryTotals.map((c) => {
                  const style = getCategoryStyle(c.categoryName);
                  const pct = total > 0 ? (c.total / total) * 100 : 0;
                  return (
                    <Pressable
                      key={c.categoryName}
                      style={styles.legendRow}
                      onPress={() =>
                        router.push({ pathname: "/category/[name]", params: { name: c.categoryName, month } })
                      }
                    >
                      <View style={[styles.legendDot, { backgroundColor: style.color }]} />
                      <Text style={styles.legendName} numberOfLines={1}>
                        {style.emoji} {c.categoryName}
                      </Text>
                      <Text style={styles.legendPct}>{pct.toFixed(1)}%</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Recent transactions</Text>
          {loading ? null : recent.length === 0 ? (
            <EmptyState icon="🧾" title="Nothing here yet" subtitle="No transactions recorded for this month." />
          ) : (
            recent.map((t) => {
              const style = getCategoryStyle(t.categoryName);
              return (
                <View key={t.id} style={styles.txRow}>
                  <View style={[styles.txIcon, { backgroundColor: style.color }]}>
                    <Text style={{ fontSize: 16 }}>{style.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txName}>{t.merchant}</Text>
                    <Text style={styles.txMeta}>{t.date}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.txAmount}>{formatMoney(Math.abs(t.amount))}</Text>
                    <Text style={styles.txCategory}>{t.categoryName}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => router.push("/add-transaction")}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
    paddingBottom: tabBarClearance,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greetingSmall: { fontSize: 14, color: neutral.textSecondary },
  greetingName: { fontSize: 22, fontWeight: "700", color: neutral.textPrimary },
  headerIcons: { flexDirection: "row", gap: spacing.sm },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  notifBadgeCount: { fontSize: 9, fontWeight: "700", color: "#FFFFFF" },
  monthPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: neutral.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  monthPillText: { fontSize: 13, fontWeight: "700", color: neutral.textPrimary },
  monthPillChevron: { fontSize: 9, color: neutral.textSecondary },
  monthDropdown: {
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    padding: spacing.xs,
    gap: 2,
    maxHeight: 260,
    overflow: "hidden",
  },
  monthOption: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.chip },
  monthOptionActive: { backgroundColor: neutral.background },
  monthOptionText: { fontSize: 14, color: neutral.textPrimary, fontWeight: "500" },
  monthOptionTextActive: { fontWeight: "700" },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.md },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start" },
  heroDivider: { width: 1, backgroundColor: "#FFFFFF33", marginHorizontal: spacing.md, alignSelf: "stretch" },
  heroLabel: { fontSize: 12, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", marginTop: 2 },
  heroValueSm: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginTop: 2 },
  heroDelta: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  heroBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF1A",
    borderRadius: radius.chip,
    padding: spacing.sm,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center",
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  assetCardIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  assetCardLabel: { fontSize: 12, color: neutral.textSecondary, fontWeight: "600" },
  assetCardValue: { fontSize: 16, fontWeight: "700", color: neutral.textPrimary, marginTop: 2 },
  assetCardDelta: { fontSize: 12, fontWeight: "600" },
  sectionCard: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: neutral.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  accountTopRow: { flexDirection: "row", justifyContent: "space-between" },
  accountName: { fontSize: 14, fontWeight: "600", color: neutral.textPrimary },
  accountAmount: { fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: neutral.border, marginTop: 6, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  accountPct: { fontSize: 12, fontWeight: "700", width: 44, textAlign: "right" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  donut: { width: 140, height: 140, borderRadius: 70, alignItems: "center", justifyContent: "center" },
  donutHole: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  donutValue: { fontSize: 15, fontWeight: "700", color: neutral.textPrimary },
  donutLabel: { fontSize: 11, color: neutral.textSecondary },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { flex: 1, fontSize: 12, color: neutral.textPrimary, fontWeight: "600" },
  legendPct: { fontSize: 12, color: neutral.textSecondary, fontWeight: "700" },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txName: { fontSize: 14, fontWeight: "600", color: neutral.textPrimary },
  txMeta: { fontSize: 12, color: neutral.textSecondary },
  txAmount: { fontSize: 14, fontWeight: "700", color: neutral.textPrimary },
  txCategory: { fontSize: 11, color: neutral.textSecondary },
  fab: {
    position: "absolute",
    right: spacing.md,
    bottom: tabBarClearance - spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4C1D95",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sheetBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: neutral.card,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: neutral.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: neutral.textPrimary, marginBottom: spacing.sm },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: neutral.border,
  },
  sheetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: neutral.background,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: neutral.textPrimary },
});
