import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState } from "react";
import { Dimensions, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { EmptyState } from "../../components/EmptyState";
import { LineChart } from "../../components/LineChart";
import { MiniSparkline } from "../../components/MiniSparkline";
import { MonthlyBarChart } from "../../components/MonthlyBarChart";
import { PressScale } from "../../components/PressScale";
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
  getNeedsReviewCount,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
  type MonthlyTotal,
} from "../../lib/db";
import { getPeriodRange, monthRange, PERIODS, type Period } from "../../lib/period";
import { radius, spacing, tabBarClearance } from "../../lib/theme";
import { ASSET_TYPES, type Account, type AssetType, type Category, type Transaction } from "../../lib/types";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

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

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
  const [reviewCount, setReviewCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(() => {
    const { start, end } = getPeriodRange(period);
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    const transactionRange = selectedMonth ? monthRange(selectedMonth) : undefined;

    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
    getLoanSummaries(db).then(setLoans);
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
    <View style={styles.safeArea}>
      <View style={styles.container}>
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

        <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} />

        <View style={styles.statRow}>
          <View style={styles.statBox}>
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
                <AnimatedAmount value={totals.expenses} style={styles.statValue} />
                <MiniSparkline points={monthlyTotals.slice(-6).map((m) => m.expenses)} color={ACCENT} />
              </>
            )}
          </View>
          <View style={styles.statBox}>
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
                <AnimatedAmount value={totals.income} style={styles.statValue} />
                <MiniSparkline points={monthlyTotals.slice(-6).map((m) => m.income)} color="#16A34A" />
              </>
            )}
          </View>
          {!loading && totals.payments !== 0 && (
            <View style={styles.statBox}>
              <View style={styles.statTopRow}>
                <Text style={styles.statLabel}>Payments</Text>
                <View style={[styles.statIconWrap, { backgroundColor: "#FFEDD5" }]}>
                  <Ionicons name="trending-up-outline" size={13} color="#F97316" />
                </View>
              </View>
              <AnimatedAmount value={totals.payments} style={styles.statValue} />
            </View>
          )}
        </View>

        <View style={styles.panelCard}>
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
                    router.push({ pathname: "/category/[name]", params: { name: loan.name, month: selectedMonth ?? period } })
                  }
                >
                  <View style={styles.assetPanel}>
                    <Text style={styles.panelTitle}>🚗 {loan.name}</Text>
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

      <Pressable style={styles.fab} onPress={() => router.push("/add-transaction")}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
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
  panelCard: {
    padding: 0,
    overflow: "hidden",
    marginBottom: spacing.md,
    marginTop: spacing.md,
    backgroundColor: neutral.card,
    borderRadius: radius.card,
  },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  statTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  statIconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 13, color: neutral.textSecondary, fontWeight: "600" },
  statValue: { fontSize: 18, fontWeight: "700", color: neutral.textPrimary, marginBottom: 6 },
  assetPanel: { padding: spacing.md, gap: spacing.xs },
  panelTitle: { fontSize: 13, fontWeight: "600", color: neutral.textSecondary },
  panelValue: { fontSize: 22, fontWeight: "700", color: neutral.textPrimary },
  panelDelta: { fontSize: 12, fontWeight: "600", color: neutral.textSecondary, marginBottom: spacing.xs },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: neutral.background,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#DC2626" },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: neutral.border },
  dotActive: { backgroundColor: ACCENT, width: 16 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: neutral.textPrimary,
  },
  clearLink: { fontSize: 13, color: ACCENT, fontWeight: "600" },
  filterScroll: { flexGrow: 0, marginBottom: spacing.md },
  filterRow: { gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: neutral.card,
  },
  filterChipText: { color: neutral.textSecondary, fontWeight: "600", fontSize: 13 },
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


