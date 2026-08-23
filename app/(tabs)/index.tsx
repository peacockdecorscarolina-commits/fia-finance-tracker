import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { MonthlyBarChart } from "../../components/MonthlyBarChart";
import { PressScale } from "../../components/PressScale";
import { Screen } from "../../components/Screen";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Shimmer } from "../../components/Shimmer";
import { TransactionRow } from "../../components/TransactionRow";
import {
  getAccounts,
  getCategories,
  getIncomeExpenseTotals,
  getMonthlyTotals,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
  type MonthlyTotal,
} from "../../lib/db";
import { getPeriodRange, monthRange, PERIODS, type Period } from "../../lib/period";
import { colors, gradientAccent, radius, spacing, tabBarClearance } from "../../lib/theme";
import type { Account, Category, Transaction } from "../../lib/types";

const CHART_MONTHS = 12;

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
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

  const load = useCallback(() => {
    const { start, end } = getPeriodRange(period);
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    const transactionRange = selectedMonth ? monthRange(selectedMonth) : undefined;

    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
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

        <Card style={styles.chartCard}>
          <MonthlyBarChart
            data={monthlyTotals}
            selectedMonth={selectedMonth}
            onSelectMonth={(month) => setSelectedMonth((current) => (current === month ? null : month))}
          />
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
            />
          )}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.statBg,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  statLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600", marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  chartCard: { marginBottom: spacing.md },
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
