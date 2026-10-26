import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { LineChart } from "../../components/LineChart";
import { TransactionRow } from "../../components/TransactionRow";
import { getCategoryStyle } from "../../lib/categoryStyle";
import {
  deleteTransaction,
  getAccounts,
  getCategories,
  getCategoryMonthlyTotals,
  getLoanStatus,
  getTransactions,
  getTransferCandidates,
  linkTransactions,
  setCategoryLoan,
  setMerchantCategory,
  setTransactionIgnored,
  unlinkTransaction,
} from "../../lib/db";
import { LOAN_KIND_ICON, LOAN_KINDS, type LoanKind, type LoanStatus } from "../../lib/loan";
import { periodRange } from "../../lib/period";
import { radius, spacing } from "../../lib/theme";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";
import type { Category, Transaction } from "../../lib/types";

// Matches the rest of the app's redesigned screens -- theme-invariant.
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
  // Either `month` ("YYYY-MM", or "YYYY" from Summary's Year view) or an
  // explicit start/end (Home's Week/Month/Year periods). Neither = all time.
  // `account` (a card's name) limits the list and trend to that card, when
  // opened from the card's own page.
  const { name, month, start: startParam, end: endParam, account } = useLocalSearchParams<{
    name: string;
    month?: string;
    start?: string;
    end?: string;
    account?: string;
  }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [editingLoan, setEditingLoan] = useState(false);
  const [loanInput, setLoanInput] = useState("");
  const [loanDateInput, setLoanDateInput] = useState("");
  const [loanRateInput, setLoanRateInput] = useState("");
  const [loanKindInput, setLoanKindInput] = useState<LoanKind>("Car");
  const [loanEscrowInput, setLoanEscrowInput] = useState("");
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; total: number }[]>([]);
  const [loanStatus, setLoanStatus] = useState<LoanStatus | null>(null);

  const category = categories.find((c) => c.name === name) ?? null;
  // Interest rate is optional: blank means no interest.
  const loanRate = loanRateInput.trim() === "" ? null : Number(loanRateInput);
  const isLoanRateValid = loanRate === null || (Number.isFinite(loanRate) && loanRate >= 0 && loanRate < 100);
  // Escrow only applies to house loans; blank means the whole payment goes to the loan.
  const loanEscrow = loanKindInput !== "House" || loanEscrowInput.trim() === "" ? null : Number(loanEscrowInput);
  const isLoanEscrowValid = loanEscrow === null || (Number.isFinite(loanEscrow) && loanEscrow >= 0);
  const isLoanInputValid =
    Number.isFinite(Number(loanInput)) &&
    Number(loanInput) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(loanDateInput) &&
    isLoanRateValid &&
    isLoanEscrowValid;
  const loanHistory = loanStatus?.history ?? [];
  // Progress is how far the balance has come down, so interest added along
  // the way counts against it.
  const paidDown = category?.loanAmount && loanStatus ? category.loanAmount - loanStatus.remaining : 0;

  const load = useCallback(() => {
    const { start, end } =
      startParam && endParam ? { start: startParam, end: endParam } : month ? periodRange(month) : {};
    getAccounts(db).then((accounts) => {
      const accountId = account ? accounts.find((a) => a.name === account)?.id : undefined;
      getTransactions(db, { categoryName: name, start, end, accountId }).then(setTransactions);
      if (name) getCategoryMonthlyTotals(db, name, TREND_MONTHS, accountId).then(setMonthlyTrend);
    });
    // Unfiltered: a tracked loan's payments count from whichever card paid them.
    getTransactions(db, { categoryName: name }).then(setAllTransactions);
    getCategories(db).then(setCategories);
  }, [db, name, month, startParam, endParam, account]);

  useFocusEffect(load);

  useEffect(() => {
    if (!name || !category?.loanAmount || !category.loanAsOfDate) {
      setLoanStatus(null);
      return;
    }
    getLoanStatus(db, {
      name,
      loanAmount: category.loanAmount,
      loanAsOfDate: category.loanAsOfDate,
      loanInterestRate: category.loanInterestRate,
      loanEscrow: category.loanEscrow,
    }).then(setLoanStatus);
  }, [
    db,
    name,
    category?.loanAmount,
    category?.loanAsOfDate,
    category?.loanInterestRate,
    category?.loanEscrow,
    allTransactions,
  ]);

  async function saveLoanAmount() {
    if (!category || !isLoanInputValid) return;
    await setCategoryLoan(db, category.id, {
      amount: Number(loanInput),
      asOfDate: loanDateInput,
      interestRate: loanRate,
      kind: loanKindInput,
      escrow: loanEscrow,
    });
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

  async function handleLinkTransfer(transaction: Transaction, candidateId: number) {
    await linkTransactions(db, transaction.id, candidateId);
    load();
  }

  async function handleUnlinkTransfer(transaction: Transaction) {
    await unlinkTransaction(db, transaction.id);
    load();
  }

  const style = getCategoryStyle(name ?? "");

  const listHeader = (
    <>
      {!category?.loanAmount && monthlyTrend.filter((m) => m.total > 0).length >= 2 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Monthly spend</Text>
          <LineChart
            points={monthlyTrend.map((m) => m.total)}
            labels={monthlyTrend.map((m) => formatMonthShort(m.month))}
            color={colors.accent}
            width={320}
          />
        </View>
      )}
      {category && (
        <View style={styles.sectionCard}>
          {editingLoan ? (
            <View style={styles.loanEditForm}>
              <Text style={styles.loanLabel}>Type</Text>
              <View style={styles.kindRow}>
                {LOAN_KINDS.map((kind) => {
                  const active = kind === loanKindInput;
                  return (
                    <Pressable
                      key={kind}
                      onPress={() => setLoanKindInput(kind)}
                      style={[styles.kindChip, active && styles.kindChipActive]}
                    >
                      <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>
                        {LOAN_KIND_ICON[kind]} {kind}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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
              <Text style={styles.loanLabel}>Interest rate (APR) — optional</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.inputText}
                  value={loanRateInput}
                  onChangeText={setLoanRateInput}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 6.49"
                  placeholderTextColor={colors.textSecondary}
                />
                <Text style={styles.dollarSign}>%</Text>
              </View>
              <Text style={styles.loanHint}>
                Find it on your loan statement. Leave blank if the loan has no interest.
              </Text>
              {loanKindInput === "House" && (
                <>
                  <Text style={styles.loanLabel}>Escrow in each payment — optional</Text>
                  <View style={styles.inputRow}>
                    <Text style={styles.dollarSign}>$</Text>
                    <TextInput
                      style={[styles.inputText, { marginLeft: 4 }]}
                      value={loanEscrowInput}
                      onChangeText={setLoanEscrowInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 450"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                  <Text style={styles.loanHint}>
                    The property tax and insurance part of your monthly mortgage payment, shown on your mortgage
                    statement. It's taken off each payment, since it doesn't pay down the loan.
                  </Text>
                </>
              )}
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
                <Text style={styles.loanLabel}>
                  {LOAN_KIND_ICON[category.loanKind ?? "Car"]} Remaining balance
                </Text>
                <Pressable
                  onPress={() => {
                    setLoanInput(String(category.loanAmount));
                    setLoanDateInput(category.loanAsOfDate ?? todayISO());
                    setLoanRateInput(category.loanInterestRate != null ? String(category.loanInterestRate) : "");
                    setLoanKindInput(category.loanKind ?? "Car");
                    setLoanEscrowInput(category.loanEscrow != null ? String(category.loanEscrow) : "");
                    setEditingLoan(true);
                  }}
                >
                  <Text style={styles.loanEditLink}>Edit</Text>
                </Pressable>
              </View>
              <Text style={styles.loanRemaining}>
                {formatMoney(loanStatus?.remaining ?? category.loanAmount)}{" "}
                <Text style={styles.loanOfTotal}>of {formatMoney(category.loanAmount)}</Text>
              </Text>
              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    styles.progressFillAbs,
                    { width: `${Math.min(100, Math.max(0, (paidDown / category.loanAmount) * 100))}%` },
                  ]}
                />
              </View>
              <Text style={styles.pctLabel}>
                {Math.round(Math.min(100, Math.max(0, (paidDown / category.loanAmount) * 100)))}% paid off
                {category.loanAsOfDate ? ` · as of ${category.loanAsOfDate}` : ""}
              </Text>
              {category.loanEscrow ? (
                <Text style={styles.pctLabel}>
                  {formatMoney(category.loanEscrow)} escrow taken off each payment
                </Text>
              ) : null}
              {category.loanInterestRate ? (
                <Text style={styles.pctLabel}>
                  {category.loanInterestRate}% APR · {formatMoney(loanStatus?.interestSoFar ?? 0)} interest since{" "}
                  {category.loanAsOfDate}
                </Text>
              ) : null}

              {loanHistory.length >= 2 && (
                <View style={styles.payoffChartWrap}>
                  <Text style={styles.loanLabel}>Payoff progress</Text>
                  <LineChart
                    points={loanHistory.map((h) => h.remaining)}
                    labels={loanHistory.map((h) => formatMonthShort(h.month))}
                    color="#DC2626"
                    width={320}
                    zeroBaseline={false}
                  />
                </View>
              )}
            </>
          ) : (
            <Pressable
              onPress={() => {
                setLoanInput("");
                setLoanDateInput(todayISO());
                setLoanRateInput("");
                setLoanKindInput("Car");
                setLoanEscrowInput("");
                setEditingLoan(true);
              }}
              style={styles.trackLoanBtn}
            >
              <Ionicons name="cash-outline" size={16} color={colors.accent} />
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

        {account ? (
          <View style={styles.accountFilterRow}>
            <Text style={styles.accountFilterText} numberOfLines={1}>
              Only {account}
            </Text>
            <Pressable onPress={() => router.setParams({ account: undefined })}>
              <Text style={styles.accountFilterLink}>Show all cards</Text>
            </Pressable>
          </View>
        ) : null}

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
              onFindTransferCandidates={(t) => getTransferCandidates(db, t)}
              onLinkTransfer={handleLinkTransfer}
              onUnlinkTransfer={handleUnlinkTransfer}
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
    accountFilterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      backgroundColor: "#EDE9FE",
      borderRadius: radius.chip,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      marginBottom: spacing.sm,
    },
    accountFilterText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#4C1D95" },
    accountFilterLink: { fontSize: 13, fontWeight: "600", color: "#4C1D95", textDecorationLine: "underline" },
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
    loanHint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    kindRow: { flexDirection: "row", gap: spacing.sm },
    kindChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    kindChipActive: { borderColor: "#4C1D95", backgroundColor: "#EDE9FE" },
    kindChipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    kindChipTextActive: { color: "#4C1D95" },
    loanEditLink: { fontSize: 13, color: colors.accent, fontWeight: "600" },
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
    payoffChartWrap: { marginTop: spacing.sm, gap: spacing.sm },
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
