import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { LineChart } from "../../components/LineChart";
import { PillButton } from "../../components/PillButton";
import { Screen } from "../../components/Screen";
import { TransactionRow } from "../../components/TransactionRow";
import { getCategoryStyle } from "../../lib/categoryStyle";
import {
  deleteTransaction,
  getCategories,
  getCategoryMonthlyTotals,
  getTransactions,
  setCategoryLoanAmount,
  setMerchantCategory,
  setTransactionIgnored,
} from "../../lib/db";
import { monthRange } from "../../lib/period";
import { colors, gradientAccent, radius, spacing } from "../../lib/theme";
import type { Category, Transaction } from "../../lib/types";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

const TREND_MONTHS = 6;

export default function CategoryDrillDownScreen() {
  const { name, month } = useLocalSearchParams<{ name: string; month: string }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [editingLoan, setEditingLoan] = useState(false);
  const [loanInput, setLoanInput] = useState("");
  const [loanDateInput, setLoanDateInput] = useState("");
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; total: number }[]>([]);

  const category = categories.find((c) => c.name === name) ?? null;
  const isLoanInputValid =
    Number.isFinite(Number(loanInput)) && Number(loanInput) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(loanDateInput);
  const paidSoFar = category?.loanAsOfDate
    ? Math.abs(
        allTransactions
          .filter((t) => !t.ignored && t.date > category.loanAsOfDate!)
          .reduce((sum, t) => sum + t.amount, 0)
      )
    : 0;

  const load = useCallback(() => {
    const { start, end } = monthRange(month);
    getTransactions(db, { categoryName: name, start, end }).then(setTransactions);
    getTransactions(db, { categoryName: name }).then(setAllTransactions);
    getCategories(db).then(setCategories);
    if (name) getCategoryMonthlyTotals(db, name, TREND_MONTHS).then(setMonthlyTrend);
  }, [db, name, month]);

  useFocusEffect(load);

  async function saveLoanAmount() {
    if (!category || !isLoanInputValid) return;
    await setCategoryLoanAmount(db, category.id, Number(loanInput), loanDateInput);
    setEditingLoan(false);
    load();
  }

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
      <Stack.Screen options={{ title: name ? `${getCategoryStyle(name).emoji} ${name}` : name }} />
      <View style={styles.container}>
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              {monthlyTrend.filter((m) => m.total > 0).length >= 2 && (
                <Card style={styles.trendCard}>
                  <Text style={styles.trendTitle}>Monthly spend</Text>
                  <LineChart
                    points={monthlyTrend.map((m) => m.total)}
                    labels={monthlyTrend.map((m) => formatMonthShort(m.month))}
                    color={colors.accent}
                    width={320}
                  />
                </Card>
              )}
              {category && (
              <Card style={styles.loanCard}>
                {editingLoan ? (
                  <View style={styles.loanEditForm}>
                    <Text style={styles.loanLabel}>Current balance</Text>
                    <TextInput
                      style={styles.loanInput}
                      value={loanInput}
                      onChangeText={setLoanInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 20659.12"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                    />
                    <Text style={styles.loanLabel}>As of date</Text>
                    <TextInput
                      style={styles.loanInput}
                      value={loanDateInput}
                      onChangeText={setLoanDateInput}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <PillButton title="Save" onPress={saveLoanAmount} disabled={!isLoanInputValid} />
                  </View>
                ) : category.loanAmount ? (
                  <>
                    <View style={styles.loanHeaderRow}>
                      <Text style={styles.loanLabel}>Remaining balance</Text>
                      <Pressable
                        onPress={() => {
                          setLoanInput(String(category.loanAmount));
                          setLoanDateInput(category.loanAsOfDate ?? todayISO());
                          setEditingLoan(true);
                        }}
                      >
                        <Text style={styles.loanEditLink}>Edit</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.loanRemaining}>
                      {formatMoney(Math.max(category.loanAmount - paidSoFar, 0))}{" "}
                      <Text style={styles.loanOfTotal}>of {formatMoney(category.loanAmount)}</Text>
                    </Text>
                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={gradientAccent}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[
                          styles.progressFillAbs,
                          {
                            width: `${Math.min(
                              100,
                              Math.max(0, (paidSoFar / category.loanAmount) * 100)
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.pctLabel}>
                      {Math.round(Math.min(100, Math.max(0, (paidSoFar / category.loanAmount) * 100)))}% paid off
                      {category.loanAsOfDate ? ` · as of ${category.loanAsOfDate}` : ""}
                    </Text>
                  </>
                ) : (
                  <Pressable
                    onPress={() => {
                      setLoanInput("");
                      setLoanDateInput(todayISO());
                      setEditingLoan(true);
                    }}
                  >
                    <Text style={styles.loanEditLink}>Track as a loan</Text>
                  </Pressable>
                )}
              </Card>
              )}
            </>
          }
          ListEmptyComponent={<Text style={styles.empty}>No transactions in this category.</Text>}
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
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
  trendCard: { marginBottom: spacing.sm, gap: spacing.sm },
  trendTitle: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  loanCard: { marginBottom: spacing.sm, gap: spacing.xs },
  loanHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  loanLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  loanEditLink: { fontSize: 13, color: colors.accent, fontWeight: "600" },
  loanRemaining: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  loanOfTotal: { fontSize: 14, fontWeight: "500", color: colors.textSecondary },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.statBg,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent },
  progressFillAbs: { height: "100%", borderRadius: radius.pill },
  pctLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  loanEditRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  loanEditForm: { gap: spacing.xs },
  loanInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
  },
});
