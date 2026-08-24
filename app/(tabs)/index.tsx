import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState } from "react";
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { LineChart } from "../../components/LineChart";
import { MonthlyBarChart } from "../../components/MonthlyBarChart";
import { PressScale } from "../../components/PressScale";
import { Screen } from "../../components/Screen";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Shimmer } from "../../components/Shimmer";
import { TransactionRow } from "../../components/TransactionRow";
import {
  deleteTransaction,
  getAccounts,
  getAssetSummaries,
  getAssetTypeHistory,
  getCategories,
  getIncomeExpenseTotals,
  getLoanSummaries,
  getMonthlyTotals,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
  type MonthlyTotal,
} from "../../lib/db";
import { getPeriodRange, monthRange, PERIODS, type Period } from "../../lib/period";
import { colors, gradientAccent, radius, spacing, tabBarClearance } from "../../lib/theme";
import { ASSET_TYPES, type Account, type AssetType, type Category, type Transaction } from "../../lib/types";

const NET_WORTH_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };
const PANEL_ORDER: AssetType[] = ["Investment", "401k", "Savings", "Cash"];
const PANEL_WIDTH = Math.min(Dimensions.get("window").width - spacing.md * 2, 420);

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CHART_MONTHS = 12;

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatChartMonth(date: string): string {
  const [year, m] = date.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

export default function TransactionsScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [period, setPeriod] = useState<Period>("Month");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState({ income: 0, expenses: 0, payments: 0 });
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<{ id: number; name: string; loanAmount: number; remaining: number }[]>([]);
  const [assets, setAssets] = useState<{ id: number; name: string; type: AssetType; balance: number }[]>([]);
  const [assetHistories, setAssetHistories] = useState<Record<AssetType, { date: string; total: number }[]>>(
    {} as Record<AssetType, { date: string; total: number }[]>
  );
  const [panelPage, setPanelPage] = useState(0);
  const panelScrollRef = useRef<ScrollView>(null);

  const load = useCallback(() => {
    const { start, end } = getPeriodRange(period);
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    const transactionRange = selectedMonth ? monthRange(selectedMonth) : undefined;

    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
    getLoanSummaries(db).then(setLoans);
    getAssetSummaries(db).then(setAssets);
    Promise.all(ASSET_TYPES.map((type) => getAssetTypeHistory(db, type).then((history) => [type, history] as const))).then(
      (entries) => setAssetHistories(Object.fromEntries(entries) as Record<AssetType, { date: string; total: number }[]>)
    );
    Promise.all([
      getTransactions(db, {
        accountId: accountFilter,
        start: transactionRange?.start,
        end: transactionRange?.end,
      }).then(setTransactions),
      getIncomeExpenseTotals(db, { accountId: accountFilter, start, end }).then(setTotals),
      getMonthlyTotals(db, CHART_MONTHS).then(setMonthlyTotals),
    ]).then(() => setLoading(false));
  }, [db, selectedAccountId, period, selectedMonth]);

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

  return (
    <Screen>
      <View style={styles.container}>
        <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} />

        <View style={styles.statRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Expenses</Text>
            {loading ? (
              <Shimmer width={90} height={20} />
            ) : (
              <AnimatedAmount value={totals.expenses} style={styles.statValue} />
            )}
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Income</Text>
            {loading ? (
              <Shimmer width={90} height={20} />
            ) : (
              <AnimatedAmount value={totals.income} style={styles.statValue} />
            )}
          </View>
          {!loading && totals.payments !== 0 && (
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Payments</Text>
              <AnimatedAmount value={totals.payments} style={styles.statValue} />
            </View>
          )}
        </View>

        <Card style={styles.panelCard}>
          <ScrollView
            ref={panelScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPanelPage(Math.round(e.nativeEvent.contentOffset.x / PANEL_WIDTH))}
          >
            <View style={{ width: PANEL_WIDTH, padding: spacing.md }}>
              <MonthlyBarChart
                data={monthlyTotals}
                selectedMonth={selectedMonth}
                onSelectMonth={(month) => setSelectedMonth((current) => (current === month ? null : month))}
              />
            </View>

            {!loading &&
              PANEL_ORDER.filter((type) => assets.some((a) => a.type === type)).map((type) => {
                const history = assetHistories[type] ?? [];
                const total = assets.filter((a) => a.type === type).reduce((sum, a) => sum + a.balance, 0);
                const first = history[0]?.total ?? total;
                const delta = total - first;
                const pct = first !== 0 ? (delta / first) * 100 : 0;
                return (
                  <Pressable key={type} style={{ width: PANEL_WIDTH }} onPress={() => router.push("/net-worth")}>
                    <View style={styles.assetPanel}>
                      <Text style={styles.panelTitle}>
                        {NET_WORTH_ICON[type]} {type}
                      </Text>
                      <Text style={styles.panelValue}>{formatMoney(total)}</Text>
                      {history.length >= 2 && (
                        <>
                          <Text style={[styles.panelDelta, { color: delta >= 0 ? colors.positive : colors.negative }]}>
                            {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%) since first entry
                          </Text>
                          <LineChart
                            points={history.map((h) => h.total)}
                            labels={history.map((h) => formatChartMonth(h.date))}
                            color={delta >= 0 ? colors.positive : colors.negative}
                            width={PANEL_WIDTH - spacing.md * 2}
                          />
                        </>
                      )}
                    </View>
                  </Pressable>
                );
              })}

            {!loading &&
              loans.map((loan) => (
                <Pressable
                  key={`loan-${loan.id}`}
                  style={{ width: PANEL_WIDTH }}
                  onPress={() =>
                    router.push({ pathname: "/category/[name]", params: { name: loan.name, month: selectedMonth ?? period } })
                  }
                >
                  <View style={styles.assetPanel}>
                    <Text style={styles.panelTitle}>🚗 {loan.name}</Text>
                    <Text style={[styles.panelValue, { color: colors.negative }]}>{formatMoney(loan.remaining)}</Text>
                    <Text style={styles.panelDelta}>owed</Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(
                              100,
                              Math.max(0, ((loan.loanAmount - loan.remaining) / loan.loanAmount) * 100)
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </Pressable>
              ))}
          </ScrollView>

          {!loading && (loans.length > 0 || assets.length > 0) && (
            <View style={styles.dotsRow}>
              {Array.from({
                length: 1 + PANEL_ORDER.filter((type) => assets.some((a) => a.type === type)).length + loans.length,
              }).map((_, i) => (
                <Pressable
                  key={i}
                  hitSlop={8}
                  onPress={() => {
                    panelScrollRef.current?.scrollTo({ x: i * PANEL_WIDTH, animated: true });
                    setPanelPage(i);
                  }}
                >
                  <View style={[styles.dot, i === panelPage && styles.dotActive]} />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {selectedMonth ? `Spent in ${formatMonthLabel(selectedMonth)}` : "Transactions"}
          </Text>
          {selectedMonth && (
            <Pressable onPress={() => setSelectedMonth(null)}>
              <Text style={styles.clearLink}>Show all</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
        >
          {[{ id: "all" as const, name: "All" }, ...accounts].map((item) => {
            const active = item.id === selectedAccountId;
            if (active) {
              return (
                <PressScale key={String(item.id)} onPress={() => setSelectedAccountId(item.id as number | "all")}>
                  <LinearGradient
                    colors={gradientAccent}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.filterChip}
                  >
                    <Text style={styles.filterChipTextActive}>{item.name}</Text>
                  </LinearGradient>
                </PressScale>
              );
            }
            return (
              <PressScale key={String(item.id)} onPress={() => setSelectedAccountId(item.id as number | "all")}>
                <View style={styles.filterChip}>
                  <Text style={styles.filterChipText}>{item.name}</Text>
                </View>
              </PressScale>
            );
          })}
        </ScrollView>

        <FlatList
          style={styles.mainList}
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                icon="🧾"
                title="No transactions here"
                subtitle="Upload a statement or add one manually to get started."
              />
            )
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  panelCard: { padding: 0, overflow: "hidden", marginBottom: spacing.md },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.statBg,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  statLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600", marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  assetPanel: { padding: spacing.md, gap: spacing.xs },
  panelTitle: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  panelValue: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  panelDelta: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.xs },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.statBg,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.negative },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 16 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  clearLink: { fontSize: 13, color: colors.accent, fontWeight: "600" },
  filterScroll: { flexGrow: 0, marginBottom: spacing.md },
  filterRow: { gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  filterChipText: { color: colors.pillInactiveText, fontWeight: "600", fontSize: 13 },
  filterChipTextActive: { color: colors.pillActiveText, fontWeight: "600", fontSize: 13 },
  mainList: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: tabBarClearance },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
});
