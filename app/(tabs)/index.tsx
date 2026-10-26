import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { DataSafetyBanner } from "../../components/DataSafetyBanner";
import { EmptyState } from "../../components/EmptyState";
import { Greeting } from "../../components/Greeting";
import { LineChart } from "../../components/LineChart";
import { MiniSparkline } from "../../components/MiniSparkline";
import { MonthlyBarChart } from "../../components/MonthlyBarChart";
import { PressScale } from "../../components/PressScale";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Shimmer } from "../../components/Shimmer";
import { SyncButton } from "../../components/SyncButton";
import { TransactionRow } from "../../components/TransactionRow";
import {
  deleteTransaction,
  getAccounts,
  getAssetSummaries,
  getAssetTypeHistory,
  getCategories,
  getIncomeExpenseTotals,
  getLoanBalanceHistory,
  getLoanSummaries,
  getMonthlyTotals,
  getNeedsReviewCount,
  getTransactions,
  getTransferCandidates,
  linkTransactions,
  setMerchantCategory,
  setTransactionIgnored,
  unlinkTransaction,
  type LoanSummary,
  type MonthlyTotal,
} from "../../lib/db";
import { autoBackupIfStale } from "../../lib/autoBackup";
import { downloadCsv, transactionsToCsv } from "../../lib/exportCsv";
import { LOAN_KIND_ICON } from "../../lib/loan";
import { getPeriodRange, monthRange, PERIODS, type Period } from "../../lib/period";
import { radius, spacing, tabBarClearance } from "../../lib/theme";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";
import { ASSET_TYPES, type Account, type AssetType, type Category, type Transaction } from "../../lib/types";

// Matches the rest of the app's redesigned screens -- theme-invariant.
const ACCENT = "#4C1D95";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const NET_WORTH_ICON: Record<AssetType, string> = { Checking: "🏧", Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵", Home: "🏡" };
const PANEL_ORDER: AssetType[] = ["Checking", "Investment", "401k", "Savings", "Cash"];
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

type MoreItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };

function MoreSheet({
  visible,
  onClose,
  items,
  title = "More tools",
}: {
  visible: boolean;
  onClose: () => void;
  items: MoreItem[];
  title?: string;
}) {
  const { colors } = useTheme();
  const sheetStyles = useMemo(() => makeSheetStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.sheetBackdrop} onPress={onClose}>
        <Pressable style={sheetStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={sheetStyles.sheetHandle} />
          <Text style={sheetStyles.sheetTitle}>{title}</Text>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={sheetStyles.sheetRow}
            >
              <View style={sheetStyles.sheetIconWrap}>
                <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
              </View>
              <Text style={sheetStyles.sheetRowLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeSheetStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: spacing.md,
      gap: spacing.xs,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: spacing.sm,
    },
    sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetRowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  });
}

export default function TransactionsScreen() {
  const { colors, mode, toggle: toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [loanHistories, setLoanHistories] = useState<Record<number, { month: string; remaining: number }[]>>({});
  const [assets, setAssets] = useState<{ id: number; name: string; type: AssetType; balance: number }[]>([]);
  const [assetHistories, setAssetHistories] = useState<Record<AssetType, { date: string; total: number }[]>>(
    {} as Record<AssetType, { date: string; total: number }[]>
  );
  const [panelPage, setPanelPage] = useState(0);
  const panelScrollRef = useRef<ScrollView>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(() => {
    const { start, end } = getPeriodRange(period);
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    const transactionRange = selectedMonth ? monthRange(selectedMonth) : undefined;

    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
    autoBackupIfStale(db);
    getLoanSummaries(db).then(async (loanList) => {
      setLoans(loanList);
      const histories = await Promise.all(
        loanList.map((l) => getLoanBalanceHistory(db, l))
      );
      setLoanHistories(Object.fromEntries(loanList.map((l, i) => [l.id, histories[i]])));
    });
    getAssetSummaries(db).then(setAssets);
    getNeedsReviewCount(db).then(setReviewCount);
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

  async function handleLinkTransfer(transaction: Transaction, candidateId: number) {
    await linkTransactions(db, transaction.id, candidateId);
    load();
  }

  async function handleUnlinkTransfer(transaction: Transaction) {
    await unlinkTransaction(db, transaction.id);
    load();
  }

  async function handleExportCsv() {
    const all = await getTransactions(db);
    downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactionsToCsv(all));
  }

  const moreItems: MoreItem[] = [
    { icon: "search-outline", label: "Search", onPress: () => router.push({ pathname: "/all-transactions", params: { search: "1" } }) },
    { icon: "repeat-outline", label: "Subscriptions", onPress: () => router.push("/subscriptions") },
    { icon: "card-outline", label: "Manage accounts", onPress: () => router.push("/accounts") },
    { icon: "pricetag-outline", label: "Categories", onPress: () => router.push("/categories") },
    { icon: "trending-up-outline", label: "Savings & Investments", onPress: () => router.push("/net-worth") },
    { icon: "swap-horizontal-outline", label: "Move", onPress: () => router.push("/move-transactions") },
    { icon: "trash-outline", label: "Delete", onPress: () => router.push("/delete-transactions") },
    ...(Platform.OS === "web"
      ? [
          { icon: "cloud-outline" as const, label: "Sync", onPress: () => router.push("/sync") },
          { icon: "download-outline" as const, label: "Export CSV", onPress: handleExportCsv },
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

  const addItems: MoreItem[] = [
    { icon: "create-outline", label: "Add transaction", onPress: () => router.push("/add-transaction") },
    { icon: "cloud-upload-outline", label: "Upload statement", onPress: () => router.push("/upload") },
  ];

  const listHeader = (
    <>
      <View style={styles.headerRow}>
        <Greeting />
        <View style={styles.headerIcons}>
          <Pressable onPress={toggleTheme} style={styles.headerIconBtn}>
            <Ionicons name={mode === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.textPrimary} />
          </Pressable>
          <SyncButton style={styles.headerIconBtn} />
          <Pressable onPress={() => setMoreOpen(true)} style={styles.headerIconBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => router.push("/review")} style={styles.headerIconBtn}>
            <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            {reviewCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeCount}>{reviewCount > 9 ? "9+" : reviewCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <DataSafetyBanner />

      {/* New users start with no accounts -- point them at the first step. */}
      {!loading && accounts.length === 0 && (
        <PressScale onPress={() => router.push("/accounts")}>
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.getStarted}>
            <View style={styles.getStartedIcon}>
              <Ionicons name="card-outline" size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.getStartedTitle}>Add your first card</Text>
              <Text style={styles.getStartedText}>
                Add the cards and bank accounts you want to track, then upload a statement for each.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFFCC" />
          </LinearGradient>
        </PressScale>
      )}

      <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} />

        <View style={styles.statRow}>
          <Pressable
            style={styles.statBox}
            onPress={() => {
              const { start, end } = getPeriodRange(period);
              router.push({ pathname: "/all-transactions", params: { start, end, mode: "expenses" } });
            }}
          >
            <View style={styles.statTopRow}>
              <Text style={styles.statLabel}>Expenses</Text>
              <View style={[styles.statIconWrap, { backgroundColor: "#EDE9FE" }]}>
                <Ionicons name="trending-down-outline" size={13} color={ACCENT} />
              </View>
            </View>
            {loading ? (
              <Shimmer width={90} height={20} />
            ) : (
              <>
                <AnimatedAmount value={totals.expenses} style={styles.statValue} wholeDollarsFrom={1000} />
                <MiniSparkline points={monthlyTotals.slice(-6).map((m) => m.expenses)} color={colors.accent} />
              </>
            )}
          </Pressable>
          <Pressable
            style={styles.statBox}
            onPress={() => {
              const { start, end } = getPeriodRange(period);
              router.push({ pathname: "/all-transactions", params: { start, end, categoryName: "Income" } });
            }}
          >
            <View style={styles.statTopRow}>
              <Text style={styles.statLabel}>Income</Text>
              <View style={[styles.statIconWrap, { backgroundColor: "#DCFCE7" }]}>
                <Ionicons name="trending-up-outline" size={13} color="#16A34A" />
              </View>
            </View>
            {loading ? (
              <Shimmer width={90} height={20} />
            ) : (
              <>
                <AnimatedAmount value={totals.income} style={styles.statValue} wholeDollarsFrom={1000} />
                <MiniSparkline points={monthlyTotals.slice(-6).map((m) => m.income)} color="#16A34A" />
              </>
            )}
          </Pressable>
          <Pressable
            style={styles.statBox}
            onPress={() => {
              const { start, end } = getPeriodRange(period);
              router.push({ pathname: "/all-transactions", params: { start, end, mode: "payments" } });
            }}
          >
            <View style={styles.statTopRow}>
              <Text style={styles.statLabel}>Payments</Text>
              <View style={[styles.statIconWrap, { backgroundColor: "#FFEDD5" }]}>
                <Ionicons name="trending-up-outline" size={13} color="#F97316" />
              </View>
            </View>
            {loading ? <Shimmer width={90} height={20} /> : <AnimatedAmount value={totals.payments} style={styles.statValue} wholeDollarsFrom={1000} />}
          </Pressable>
        </View>

        <View style={styles.panelCard}>
          <ScrollView
            ref={panelScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            // onScroll, not onMomentumScrollEnd: the web build never fires
            // momentum events, so the dots never moved on swipe there.
            onScroll={(e) => setPanelPage(Math.round(e.nativeEvent.contentOffset.x / PANEL_WIDTH))}
            scrollEventThrottle={16}
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
                          <Text
                            style={[styles.panelDelta, { color: delta >= 0 ? "#16A34A" : "#DC2626" }]}
                          >
                            {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%) since first entry
                          </Text>
                          <LineChart
                            points={history.map((h) => h.total)}
                            labels={history.map((h) => formatChartMonth(h.date))}
                            color={delta >= 0 ? "#16A34A" : "#DC2626"}
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
                    router.push({
                      pathname: "/category/[name]",
                      params: selectedMonth
                        ? { name: loan.name, month: selectedMonth }
                        : { name: loan.name, ...getPeriodRange(period) },
                    })
                  }
                >
                  <View style={styles.assetPanel}>
                    <Text style={styles.panelTitle}>
                      {LOAN_KIND_ICON[loan.loanKind ?? "Car"]} {loan.name}
                    </Text>
                    <Text style={[styles.panelValue, { color: "#DC2626" }]}>{formatMoney(loan.remaining)}</Text>
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
                    {(loanHistories[loan.id]?.length ?? 0) >= 2 && (
                      <LineChart
                        points={loanHistories[loan.id].map((h) => h.remaining)}
                        labels={loanHistories[loan.id].map((h) => formatChartMonth(h.month))}
                        color="#DC2626"
                        width={PANEL_WIDTH - spacing.md * 2}
                        zeroBaseline={false}
                      />
                    )}
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
        </View>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {selectedMonth ? `Spent in ${formatMonthLabel(selectedMonth)}` : "Transactions"}
          </Text>
          <View style={styles.sectionTitleActions}>
            {selectedMonth && (
              <Pressable onPress={() => setSelectedMonth(null)}>
                <Text style={styles.clearLink}>Clear filter</Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.push("/all-transactions")}>
              <Text style={styles.clearLink}>See all</Text>
            </Pressable>
          </View>
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
                  <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.filterChip}>
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
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <FlatList
          style={styles.mainList}
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            // With no accounts yet, the "Add your first card" banner is the
            // next step -- this would only repeat it, below the fold.
            loading || accounts.length === 0 ? null : (
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
              onFindTransferCandidates={(t) => getTransferCandidates(db, t)}
              onLinkTransfer={handleLinkTransfer}
              onUnlinkTransfer={handleUnlinkTransfer}
            />
          )}
        />
      </View>

      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <MoreSheet visible={addOpen} onClose={() => setAddOpen(false)} items={addItems} title="Add" />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  headerIcons: { flexDirection: "row", gap: spacing.sm },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
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
  panelCard: {
    padding: 0,
    overflow: "hidden",
    marginBottom: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.card,
  },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  getStarted: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  getStartedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center",
  },
  getStartedTitle: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  getStartedText: { fontSize: 12, color: "#FFFFFFCC", marginTop: 2, lineHeight: 17 },
  statBox: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  statTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  statIconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  statValue: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginBottom: 6 },
  assetPanel: { padding: spacing.md, gap: spacing.xs },
  panelTitle: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  panelValue: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  panelDelta: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.xs },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#DC2626" },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 16 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitleActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
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
    borderRadius: 999,
    backgroundColor: colors.card,
  },
  filterChipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  filterChipTextActive: { color: "#FFFFFF", fontWeight: "600", fontSize: 13 },
  mainList: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: tabBarClearance },
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
  });
}


