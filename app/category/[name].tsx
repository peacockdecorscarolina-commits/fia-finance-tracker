import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { PillButton } from "../../components/PillButton";
import { Screen } from "../../components/Screen";
import { TransactionRow } from "../../components/TransactionRow";
import { getCategoryStyle } from "../../lib/categoryStyle";
import {
  deleteTransaction,
  getCategories,
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

export default function CategoryDrillDownScreen() {
  const { name, month } = useLocalSearchParams<{ name: string; month: string }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTimeTotal, setAllTimeTotal] = useState(0);
  const [editingLoan, setEditingLoan] = useState(false);
  const [loanInput, setLoanInput] = useState("");

  const category = categories.find((c) => c.name === name) ?? null;
  const paidSoFar = Math.abs(allTimeTotal);

  const load = useCallback(() => {
    const { start, end } = monthRange(month);
    getTransactions(db, { categoryName: name, start, end }).then(setTransactions);
    getTransactions(db, { categoryName: name }).then((all) => {
      const total = all
        .filter((t) => !t.ignored)
        .reduce((sum, t) => sum + t.amount, 0);
      setAllTimeTotal(total);
    });
    getCategories(db).then(setCategories);
  }, [db, name, month]);

  useFocusEffect(load);

  async function saveLoanAmount() {
    if (!category) return;
    const value = Number(loanInput);
    await setCategoryLoanAmount(db, category.id, Number.isFinite(value) && value > 0 ? value : null);
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
            category ? (
              <Card style={styles.loanCard}>
                {category.loanAmount ? (
                  editingLoan ? (
                    <View style={styles.loanEditRow}>
                      <TextInput
                        style={styles.loanInput}
                        value={loanInput}
                        onChangeText={setLoanInput}
                        keyboardType="decimal-pad"
                        placeholder="Loan amount"
                        placeholderTextColor={colors.textSecondary}
                      />
                      <PillButton title="Save" onPress={saveLoanAmount} />
                    </View>
                  ) : (
                    <>
                      <View style={styles.loanHeaderRow}>
                        <Text style={styles.loanLabel}>Remaining balance</Text>
                        <Pressable
                          onPress={() => {
                            setLoanInput(String(category.loanAmount));
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
                      </Text>
                    </>
                  )
                ) : editingLoan ? (
                  <View style={styles.loanEditRow}>
                    <TextInput
                      style={styles.loanInput}
                      value={loanInput}
                      onChangeText={setLoanInput}
                      keyboardType="decimal-pad"
                      placeholder="Loan amount"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                    />
                    <PillButton title="Save" onPress={saveLoanAmount} />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setLoanInput("");
                      setEditingLoan(true);
                    }}
                  >
                    <Text style={styles.loanEditLink}>Track as a loan</Text>
                  </Pressable>
                )}
              </Card>
            ) : null
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
