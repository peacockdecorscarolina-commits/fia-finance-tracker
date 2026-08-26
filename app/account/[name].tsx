import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { LineChart } from "../../components/LineChart";
import { TransactionRow } from "../../components/TransactionRow";
import { getAccountStyle } from "../../lib/accountStyle";
import {
  deleteTransaction,
  getAccountDailySpend,
  getAccountMonthlyTotals,
  getAccounts,
  getAccountSpendSummary,
  getCategories,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
} from "../../lib/db";
import { currentMonth, monthRange, recentMonths, shiftMonth } from "../../lib/period";
import { radius, spacing } from "../../lib/theme";
import type { Account, Category, Transaction } from "../../lib/types";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const TREND_MONTHS = 6;

// Rough (not precise) running total by week-of-month -- just meant to show
// the shape of spending through the month, not an exact daily ledger.
function weeklyPace(daily: { date: string; total: number }[], month: string): { label: string; total: number }[] {
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(year, m, 0).getDate();
  const weekCount = Math.ceil(daysInMonth / 7);
  const buckets = new Array(weekCount).fill(0);
  for (const d of daily) {
    const day = Number(d.date.slice(8, 10));
    const idx = Math.min(weekCount - 1, Math.floor((day - 1) / 7));
    buckets[idx] += d.total;
  }
  let running = 0;
  return buckets.map((b, i) => {
    running += b;
    return { label: `Wk ${i + 1}`, total: running };
  });
}

// Small white-on-gradient trend line for the hero card -- distinct from the
// full LineChart (which has an axis + white background, wrong for here).
// Theme-invariant white dots on the purple hero gradient.
const heroTrendStyles = StyleSheet.create({
  dot: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  dotLast: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#FFFFFF66" },
});

function HeroTrend({ points, width = 110, height = 56 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <View style={{ width, height }} />;
  const max = Math.max(...points);
  const min = Math.min(0, Math.min(...points));
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => ({ x: i * stepX, y: height - ((p - min) / range) * height }));

  return (
    <View style={{ width, height }}>
      {coords.slice(1).map((c, i) => {
        const from = coords[i];
        const dx = c.x - from.x;
        const dy = c.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: from.x,
              top: from.y - 1,
              width: length,
              height: 2,
              backgroundColor: "#FFFFFF",
              borderRadius: 1,
              transform: [{ rotate: `${angleDeg}deg` }],
              transformOrigin: "0 0",
            }}
          />
        );
      })}
      {coords.map((c, i) => {
        const isLast = i === coords.length - 1;
        return (
          <View
            key={`dot-${i}`}
            style={[
              heroTrendStyles.dot,
              { left: c.x - (isLast ? 6 : 3), top: c.y - (isLast ? 6 : 3) },
              isLast && heroTrendStyles.dotLast,
            ]}
          />
        );
      })}
    </View>
  );
}

export default function AccountDrillDownScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { name, month: monthParam } = useLocalSearchParams<{ name: string; month: string }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [month, setMonth] = useState(monthParam || currentMonth());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [monthlyTotals, setMonthlyTotals] = useState<{ month: string; total: number }[]>([]);
  const [summary, setSummary] = useState({ spent: 0, received: 0 });
  const [dailySpend, setDailySpend] = useState<{ date: string; total: number }[]>([]);

  const load = useCallback(() => {
    getAccounts(db).then((accounts) => {
      const found = accounts.find((a) => a.name === name) ?? null;
      setAccount(found);
      if (found) {
        const { start, end } = monthRange(month);
        getTransactions(db, { accountId: found.id, start, end }).then(setTransactions);
        getAccountMonthlyTotals(db, found.id, 24).then(setMonthlyTotals);
        getAccountSpendSummary(db, found.id, start, end).then(setSummary);
        getAccountDailySpend(db, found.id, start, end).then(setDailySpend);
      }
    });
    getCategories(db).then(setCategories);
  }, [db, name, month]);

  useFocusEffect(load);

  async function handleToggleIgnored(transaction: Transaction) {
    await setTransactionIgnored(db, transaction.id, !transaction.ignored);
    load();
  }

  async function handleChangeCategory(transaction: Transaction, categoryId: number) {
    await setMerchantCategory(db, transaction.merchant, categoryId);
    load();
  }

  async function handleDelete(transaction: Transaction) {
    await deleteTransaction(db, transaction.id);
    load();
  }

  const style = getAccountStyle(name ?? "");
  const trend = monthlyTotals.filter((m) => m.month <= month).slice(-TREND_MONTHS);
  const prevMonthKey = shiftMonth(month, -1);
  const prevTotal = monthlyTotals.find((m) => m.month === prevMonthKey)?.total ?? 0;
  const delta = summary.spent - prevTotal;
  const pct = prevTotal !== 0 ? (delta / prevTotal) * 100 : null;
  const net = summary.spent - summary.received;
  const pace = weeklyPace(dailySpend, month);

  const listHeader = (
    <>
      <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Spent in {formatMonthLabel(month)}</Text>
            <Text style={styles.heroValue}>{formatMoney(summary.spent)}</Text>
            <View style={styles.heroDeltaPill}>
              <Text style={[styles.heroDeltaText, { color: delta <= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                {delta <= 0 ? "▼" : "▲"} {pct !== null ? `${Math.abs(pct).toFixed(1)}%` : formatMoney(Math.abs(delta))}
              </Text>
              <Text style={styles.heroDeltaSub}>vs {formatMonthLabel(prevMonthKey)}</Text>
            </View>
          </View>
          {trend.length >= 2 && <HeroTrend points={trend.map((t) => t.total)} />}
        </View>
      </LinearGradient>

      {pace.filter((p) => p.total > 0).length >= 2 && (
        <View style={styles.paceCard}>
          <Text style={styles.paceTitle}>Spending pace this month</Text>
          <LineChart
            points={pace.map((p) => p.total)}
            labels={pace.map((p) => p.label)}
            color={colors.accent}
            width={320}
          />
        </View>
      )}

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Transactions</Text>
        <View>
          <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.monthPill}>
            <Ionicons name="calendar-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.monthPillText}>{formatMonthLabel(month)}</Text>
            <Ionicons name={pickerOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
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
        </View>
      </View>
    </>
  );

  const listFooter =
    transactions.length > 0 ? (
      <View style={styles.footerCard}>
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#EDE9FE" }]}>
            <Ionicons name="arrow-down" size={14} color="#4C1D95" />
          </View>
          <Text style={styles.footerLabel}>Total spent</Text>
          <Text style={styles.footerValue}>{formatMoney(summary.spent)}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#DCFCE7" }]}>
            <Ionicons name="arrow-up" size={14} color="#16A34A" />
          </View>
          <Text style={styles.footerLabel}>Total received</Text>
          <Text style={styles.footerValue}>{formatMoney(summary.received)}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#DBEAFE" }]}>
            <Ionicons name="swap-vertical" size={14} color="#2563EB" />
          </View>
          <Text style={styles.footerLabel}>Net</Text>
          <Text style={styles.footerValue}>{formatMoney(net)}</Text>
        </View>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name ? `${style.emoji} ${name}` : "Account"}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <FlatList
          style={styles.mainList}
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListHeaderComponentStyle={styles.listHeaderWrap}
          ListFooterComponent={listFooter}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No transactions on this card.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              onToggleIgnored={handleToggleIgnored}
              categories={categories}
              onChangeCategory={handleChangeCategory}
              onDelete={handleDelete}
            />
          )}
        />
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    zIndex: 20,
  },
  monthPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  monthPillText: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  monthDropdown: {
    position: "absolute",
    top: 42,
    right: 0,
    width: 190,
    maxHeight: 220,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    shadowColor: "#0F172A",
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    zIndex: 30,
  },
  monthOption: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.chip },
  monthOptionActive: { backgroundColor: colors.background },
  monthOptionText: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  monthOptionTextActive: { fontWeight: "700" },
  hero: { borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.md },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", marginTop: 2 },
  heroDeltaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF1A",
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  heroDeltaText: { fontSize: 12, fontWeight: "700" },
  heroDeltaSub: { fontSize: 11, color: "#FFFFFFCC" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },
  paceCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  paceTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  mainList: { flex: 1 },
  listHeaderWrap: { zIndex: 20 },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, alignItems: "center" },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  footerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  footerCol: { flex: 1, alignItems: "center", gap: 4 },
  footerDivider: { width: 1, height: 36, backgroundColor: colors.border },
  footerIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  footerLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },
  footerValue: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  });
}
