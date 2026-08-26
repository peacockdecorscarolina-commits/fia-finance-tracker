import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { LineChart } from "../../components/LineChart";
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
import { radius, spacing } from "../../lib/theme";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";
import type { Category, Transaction } from "../../lib/types";

// Matches the rest of the app's redesigned screens -- theme-invariant.
const ACCENT = "#4C1D95";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  const style = getCategoryStyle(name ?? "");

  const listHeader = (
    <>
      {monthlyTrend.filter((m) => m.total > 0).length >= 2 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Monthly spend</Text>
          <LineChart
            points={monthlyTrend.map((m) => m.total)}
            labels={monthlyTrend.map((m) => formatMonthShort(m.month))}
            color={ACCENT}
            width={320}
          />
        </View>
      )}
      {category && (
        <View style={styles.sectionCard}>
          {editingLoan ? (
            <View style={styles.loanEditForm}>
              <Text style={styles.loanLabel}>Current balance</Text>
              <View style={styles.inputRow}>
                <Text style={styles.dollarSign}>$</Text>
                <TextInput
                  style={[styles.inputText, { marginLeft: 4 }]}
                  value={loanInput}
                  onChangeText={setLoanInput}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 20659.12"
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                />
              </View>
              <Text style={styles.loanLabel}>As of date</Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={[styles.inputText, { marginLeft: 6 }]}
                  value={loanDateInput}
                  onChangeText={setLoanDateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={styles.loanEditActions}>
                <Pressable onPress={() => setEditingLoan(false)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveLoanAmount}
                  disabled={!isLoanInputValid}
                  style={{ flex: 1, opacity: isLoanInputValid ? 1 : 0.5 }}
                >
                  <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                    <Text style={styles.saveBtnText}>Save</Text>
                  </LinearGradient>
                </Pressable>
              </View>
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
                  colors={GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    styles.progressFillAbs,
                    { width: `${Math.min(100, Math.max(0, (paidSoFar / category.loanAmount) * 100))}%` },
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
              style={styles.trackLoanBtn}
            >
              <Ionicons name="car-outline" size={16} color={ACCENT} />
              <Text style={styles.loanEditLink}>Track as a loan</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name ? `${style.emoji} ${name}` : "Category"}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No transactions in this category.</Text>
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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.textPrimary },
    list: { gap: spacing.sm, paddingBottom: spacing.xl },
    emptyCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, alignItems: "center" },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
    sectionCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    loanHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    loanLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    loanEditLink: { fontSize: 13, color: ACCENT, fontWeight: "600" },
    loanRemaining: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
    loanOfTotal: { fontSize: 14, fontWeight: "500", color: colors.textSecondary },
    progressTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      overflow: "hidden",
      marginTop: spacing.xs,
    },
    progressFillAbs: { height: "100%", borderRadius: radius.pill },
    pctLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    loanEditForm: { gap: spacing.xs },
    loanEditActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    inputText: { flex: 1, fontSize: 15, color: colors.textPrimary },
    dollarSign: { fontSize: 15, color: colors.textSecondary, fontWeight: "600" },
    cancelBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.background,
    },
    cancelBtnText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
    saveBtn: { borderRadius: radius.pill, paddingVertical: 12, alignItems: "center" },
    saveBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    trackLoanBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  });
}
