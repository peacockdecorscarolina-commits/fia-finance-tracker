import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { AmountText } from "../../components/AmountText";
import { CardBenefitsPanel } from "../../components/CardBenefitsPanel";
import { StatementStatusCard } from "../../components/StatementStatusCard";
import { LineChart } from "../../components/LineChart";
import { SegmentedControl } from "../../components/SegmentedControl";
import { TransactionRow } from "../../components/TransactionRow";
import { getAccountStyle } from "../../lib/accountStyle";
import { getCategoryStyle } from "../../lib/categoryStyle";
import { formatMerchantName } from "../../lib/formatMerchant";
import {
  deleteTransaction,
  getAccountDailySpend,
  getAccountBalanceAsOf,
  getAccountLedger,
  getAccountMonthlyTotals,
  getAccounts,
  getAccountSpendSummary,
  getCategories,
  getCardOverviews,
  getCategorySummary,
  getTransactionMonthBounds,
  getTransactions,
  getTransferCandidates,
  linkTransactions,
  todayISO,
  setMerchantCategory,
  setTransactionIgnored,
  unlinkTransaction,
  type CardOverview,
  type CategoryTotal,
  type TransactionWithBalance,
} from "../../lib/db";
import { currentMonth, monthsBetween, periodRange, shiftMonth } from "../../lib/period";
import { radius, spacing } from "../../lib/theme";
import type { Category, Transaction } from "../../lib/types";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const TREND_MONTHS = 6;

function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const VIEWS = ["Month", "Year"] as const;

function formatMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

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
  // `month` is "YYYY-MM", or a bare "YYYY" when opened from the Accounts
  // tab's Year view -- which opens this page on that whole year.
  const { name, month: monthParam } = useLocalSearchParams<{ name: string; month: string }>();
  const openedOnYear = /^\d{4}$/.test(monthParam ?? "");
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ledger, setLedger] = useState<TransactionWithBalance[]>([]);
  const [hasBalanceTracking, setHasBalanceTracking] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  // Year view keeps a month too, so switching back to Month lands somewhere
  // sensible: the current month for this year, December for past years.
  const [view, setView] = useState<(typeof VIEWS)[number]>(openedOnYear ? "Year" : "Month");
  const [month, setMonth] = useState(() => {
    if (!monthParam) return currentMonth();
    if (!openedOnYear) return monthParam;
    return monthParam === currentMonth().slice(0, 4) ? currentMonth() : `${monthParam}-12`;
  });
  const [monthBounds, setMonthBounds] = useState<{ first: string; last: string } | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [cardOverview, setCardOverview] = useState<CardOverview | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [monthlyTotals, setMonthlyTotals] = useState<{ month: string; total: number }[]>([]);
  const [summary, setSummary] = useState({ spent: 0, received: 0 });
  const [dailySpend, setDailySpend] = useState<{ date: string; total: number }[]>([]);
  // Checking and Savings accounts are about the balance, not spending: their
  // page shows the balance, its change over the period and a balance chart.
  const [isBank, setIsBank] = useState(false);
  const [balancePoints, setBalancePoints] = useState<{ label: string; balance: number }[]>([]);
  const [balanceStart, setBalanceStart] = useState<number | null>(null);
  const [balanceEnd, setBalanceEnd] = useState<{ balance: number; date: string } | null>(null);
  const ledgerDefaulted = useRef(false);
  // What's owed on a credit card right now (null = no balance known yet).
  const [cardOwed, setCardOwed] = useState<number | null>(null);
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);

  const year = month.slice(0, 4);
  const periodKey = view === "Year" ? year : month;

  const load = useCallback(() => {
    getTransactionMonthBounds(db).then(setMonthBounds);
    getAccounts(db).then((accounts) => {
      const found = accounts.find((a) => a.name === name) ?? null;
      setAccountId(found?.id ?? null);
      if (found) {
        const { start, end } = periodRange(periodKey);
        getTransactions(db, { accountId: found.id, start, end }).then(setTransactions);
        getCategorySummary(db, periodKey, found.id).then(setCategoryTotals);
        // Benefits are about right now, not the picked period.
        getCardOverviews(db).then((all) => setCardOverview(all.find((o) => o.account.id === found.id) ?? null));
        // Long enough to cover last year in full for the Year comparison.
        getAccountMonthlyTotals(db, found.id, 36).then(setMonthlyTotals);
        getAccountSpendSummary(db, found.id, start, end).then(setSummary);
        getAccountDailySpend(db, found.id, start, end).then(setDailySpend);
        setHasBalanceTracking(found.startingBalance !== null);
        if (found.startingBalance !== null) {
          getAccountLedger(db, found.id, start, end).then(setLedger);
        } else {
          setLedger([]);
        }
        setIsCreditCard(found.type === "Credit Card");
        if (found.type === "Credit Card") {
          getAccountBalanceAsOf(db, found.id, todayISO()).then((b) => setCardOwed(b === null ? null : -b));
        }
        const bank = found.type === "Checking" || found.type === "Savings";
        setIsBank(bank);
        if (bank && found.startingBalance !== null) {
          // A bank account opens on its running-balance list.
          if (!ledgerDefaulted.current) {
            ledgerDefaulted.current = true;
            setShowLedger(true);
          }
          loadBalances(found.id, start, end);
        } else {
          setBalancePoints([]);
          setBalanceStart(null);
          setBalanceEnd(null);
        }
      }
    });
    getCategories(db).then(setCategories);
  }, [db, name, periodKey]);

  useFocusEffect(load);

  // Balance at the period's start and end (or today, mid-period), plus one
  // point per month end (Year view) or week end (Month view) for the chart.
  async function loadBalances(accountId: number, start: string, end: string) {
    const today = todayISO();
    const last = end < today ? end : today;
    const dayBefore = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10);
    const opening = await getAccountBalanceAsOf(db, accountId, dayBefore);
    const closing = await getAccountBalanceAsOf(db, accountId, last);
    const stops: { label: string; date: string }[] = [];
    if (/^\d{4}$/.test(periodKey)) {
      for (let m = 1; m <= 12; m++) {
        const monthEnd = new Date(Date.UTC(Number(periodKey), m, 0)).toISOString().slice(0, 10);
        const date = monthEnd < last ? monthEnd : last;
        stops.push({ label: formatMonthShort(`${periodKey}-${String(m).padStart(2, "0")}`), date });
        if (date === last) break;
      }
    } else {
      for (const day of [7, 14, 21, 28, 31]) {
        const [y, mo] = start.split("-").map(Number);
        const d = Math.min(day, new Date(y, mo, 0).getDate());
        const date = `${start.slice(0, 8)}${String(d).padStart(2, "0")}`;
        const capped = date < last ? date : last;
        if (stops.some((s) => s.date === capped)) break;
        stops.push({ label: `${start.slice(5, 7)}/${capped.slice(8)}`, date: capped });
        if (capped === last) break;
      }
    }
    const points: { label: string; balance: number }[] = [];
    for (const stop of stops) {
      const value = await getAccountBalanceAsOf(db, accountId, stop.date);
      if (value !== null) points.push({ label: stop.label, balance: value });
    }
    setBalanceStart(opening);
    setBalanceEnd(closing === null ? null : { balance: closing, date: last });
    setBalancePoints(points);
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

  const style = getAccountStyle(name ?? "");
  const isYear = view === "Year";
  const periodLabel = isYear ? year : formatMonthLabel(month);
  // Each month of the selected year, through this month for the current year.
  const yearMonths = monthsBetween(year === currentMonth().slice(0, 4) ? currentMonth() : `${year}-12`, `${year}-01`).reverse();
  const yearByMonth = yearMonths.map((m) => ({ month: m, total: monthlyTotals.find((t) => t.month === m)?.total ?? 0 }));
  const trend = isYear ? yearByMonth : monthlyTotals.filter((m) => m.month <= month).slice(-TREND_MONTHS);
  const prevKey = isYear ? String(Number(year) - 1) : shiftMonth(month, -1);
  const prevTotal = isYear
    ? monthlyTotals.filter((m) => m.month.startsWith(prevKey)).reduce((sum, m) => sum + m.total, 0)
    : (monthlyTotals.find((m) => m.month === prevKey)?.total ?? 0);
  const delta = summary.spent - prevTotal;
  const pct = prevTotal !== 0 ? (delta / prevTotal) * 100 : null;
  // A year still in progress against a full previous year would always read
  // as a big drop, so that comparison waits until the year is over.
  const showDelta = !isYear || year < currentMonth().slice(0, 4);
  const net = summary.spent - summary.received;
  // Everything in and out of a bank account, transfers included -- the
  // balance moves with all of it.
  const moneyIn = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const moneyOut = transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum - t.amount, 0);
  const pace = weeklyPace(dailySpend, month);

  // Refunds can leave a category net negative; only actual spending is shown.
  const spendingCategories = categoryTotals.filter((c) => c.total > 0);
  const categorySpendTotal = spendingCategories.reduce((sum, c) => sum + c.total, 0);

  const pickerEdges = [currentMonth(), month, ...(monthBounds ? [monthBounds.first, monthBounds.last] : [])].sort();
  const pickerMonths = monthsBetween(pickerEdges[pickerEdges.length - 1], pickerEdges[0]);
  const pickerYears = [...new Set(pickerMonths.map((m) => m.slice(0, 4)))];

  const listHeader = (
    <>
      <View style={styles.viewToggle}>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      </View>

      {isBank && (
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          {balanceEnd ? (
            <>
              <Text style={styles.heroLabel}>Balance · as of {formatShortDate(balanceEnd.date)}</Text>
              <Text style={styles.heroValue}>{formatMoney(balanceEnd.balance)}</Text>
              {balanceStart !== null && (
                <View style={styles.heroDeltaPill}>
                  <Text
                    style={[
                      styles.heroDeltaText,
                      { color: balanceEnd.balance - balanceStart >= 0 ? "#86EFAC" : "#FCA5A5" },
                    ]}
                  >
                    {balanceEnd.balance - balanceStart >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(balanceEnd.balance - balanceStart))}
                  </Text>
                  <Text style={styles.heroDeltaSub}>since {isYear ? `Jan 1, ${year}` : formatShortDate(periodRange(periodKey).start)}</Text>
                </View>
              )}
              <Text style={[styles.heroDeltaSub, { marginTop: spacing.xs }]}>
                {formatMoney(moneyIn)} in · {formatMoney(moneyOut)} out in {periodLabel}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.heroLabel}>Balance</Text>
              <Text style={styles.heroValueMuted}>Not set yet</Text>
              <Pressable onPress={() => router.push("/net-worth")} style={styles.setBalanceBtn}>
                <Text style={styles.setBalanceText}>{"Set today's balance"}</Text>
              </Pressable>
            </>
          )}
        </LinearGradient>
      )}

      {isBank && balancePoints.length >= 2 && (
        <View style={styles.paceCard}>
          <Text style={styles.paceTitle}>Balance over {periodLabel}</Text>
          <LineChart
            points={balancePoints.map((p) => p.balance)}
            labels={balancePoints.map((p) => p.label)}
            color={colors.accent}
            width={320}
            zeroBaseline={false}
          />
        </View>
      )}

      {!isBank && (
      <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Spent in {periodLabel}</Text>
            <Text style={styles.heroValue}>{formatMoney(summary.spent)}</Text>
            {isCreditCard && (
              <Pressable onPress={() => router.push("/accounts")}>
                <Text style={styles.heroOwed}>
                  {cardOwed === null ? "What you owe: not set yet — set it" : `You owe ${formatMoney(cardOwed)} today`}
                </Text>
              </Pressable>
            )}
            {showDelta && (
              <View style={styles.heroDeltaPill}>
                <Text style={[styles.heroDeltaText, { color: delta <= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                  {delta <= 0 ? "▼" : "▲"} {pct !== null ? `${Math.abs(pct).toFixed(1)}%` : formatMoney(Math.abs(delta))}
                </Text>
                <Text style={styles.heroDeltaSub}>vs {isYear ? prevKey : formatMonthLabel(prevKey)}</Text>
              </View>
            )}
          </View>
          {trend.length >= 2 && <HeroTrend points={trend.map((t) => t.total)} />}
        </View>
      </LinearGradient>
      )}

      {!isBank && isYear && yearByMonth.filter((m) => m.total > 0).length >= 2 && (
        <View style={styles.paceCard}>
          <Text style={styles.paceTitle}>Spending by month</Text>
          <LineChart
            points={yearByMonth.map((m) => m.total)}
            labels={yearByMonth.map((m) => formatMonthShort(m.month))}
            color={colors.accent}
            width={320}
          />
        </View>
      )}

      {!isBank && !isYear && pace.filter((p) => p.total > 0).length >= 2 && (
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

      {spendingCategories.length > 0 && (
        <View style={styles.paceCard}>
          <Text style={styles.paceTitle}>By category</Text>
          {spendingCategories.map((c) => {
            const catStyle = getCategoryStyle(c.categoryName);
            const share = categorySpendTotal > 0 ? (c.total / categorySpendTotal) * 100 : 0;
            return (
              <Pressable
                key={c.categoryName}
                style={styles.categoryLine}
                onPress={() => router.push({ pathname: "/category/[name]", params: { name: c.categoryName, month: periodKey, account: name } })}
              >
                <View style={styles.categoryLineTop}>
                  <Text style={styles.categoryLineName} numberOfLines={1}>
                    {catStyle.emoji} {c.categoryName}
                  </Text>
                  <Text style={styles.categoryLineAmount}>{formatMoney(c.total)}</Text>
                  <Text style={styles.categoryLinePct}>{share.toFixed(0)}%</Text>
                </View>
                <View style={styles.categoryBarTrack}>
                  <View style={[styles.categoryBarFill, { width: `${share}%`, backgroundColor: catStyle.color }]} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {accountId !== null && <StatementStatusCard accountId={accountId} />}

      {cardOverview && (
        <View style={{ marginBottom: spacing.md }}>
          <CardBenefitsPanel overview={cardOverview} onChanged={load} />
        </View>
      )}

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Transactions</Text>
        <View>
          <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.monthPill}>
            <Ionicons name="calendar-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.monthPillText}>{periodLabel}</Text>
            <Ionicons name={pickerOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
          </Pressable>

          {pickerOpen && (
            <ScrollView style={styles.monthDropdown} nestedScrollEnabled>
              {isYear
                ? pickerYears.map((y) => (
                    <Pressable
                      key={y}
                      style={[styles.monthOption, y === year && styles.monthOptionActive]}
                      onPress={() => {
                        // Same month-of-year in the picked year, capped at the newest month offered.
                        const target = `${y}-${month.slice(5)}`;
                        setMonth(target > pickerMonths[0] ? pickerMonths[0] : target);
                        setPickerOpen(false);
                      }}
                    >
                      <Text style={[styles.monthOptionText, y === year && styles.monthOptionTextActive]}>{y}</Text>
                    </Pressable>
                  ))
                : pickerMonths.map((m) => (
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

      {hasBalanceTracking && (
        <View style={styles.ledgerToggleRow}>
          <Pressable
            onPress={() => setShowLedger(false)}
            style={[styles.ledgerToggleBtn, !showLedger && styles.ledgerToggleBtnActive]}
          >
            <Text style={[styles.ledgerToggleText, !showLedger && styles.ledgerToggleTextActive]}>List</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowLedger(true)}
            style={[styles.ledgerToggleBtn, showLedger && styles.ledgerToggleBtnActive]}
          >
            <Ionicons name="trending-up" size={13} color={showLedger ? "#FFFFFF" : colors.textSecondary} />
            <Text style={[styles.ledgerToggleText, showLedger && styles.ledgerToggleTextActive]}>Balance</Text>
          </Pressable>
        </View>
      )}
    </>
  );

  const listFooter =
    transactions.length > 0 ? (
      <View style={styles.footerCard}>
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#EDE9FE" }]}>
            <Ionicons name="arrow-down" size={14} color="#4C1D95" />
          </View>
          <Text style={styles.footerLabel}>{isBank ? "Money out" : "Total spent"}</Text>
          <Text style={styles.footerValue}>{formatMoney(isBank ? moneyOut : summary.spent)}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#DCFCE7" }]}>
            <Ionicons name="arrow-up" size={14} color="#16A34A" />
          </View>
          <Text style={styles.footerLabel}>{isBank ? "Money in" : "Total received"}</Text>
          <Text style={styles.footerValue}>{formatMoney(isBank ? moneyIn : summary.received)}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <View style={[styles.footerIcon, { backgroundColor: "#DBEAFE" }]}>
            <Ionicons name="swap-vertical" size={14} color="#2563EB" />
          </View>
          <Text style={styles.footerLabel}>{isBank ? "Net change" : "Net"}</Text>
          <Text style={styles.footerValue}>{formatMoney(isBank ? moneyIn - moneyOut : net)}</Text>
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

        {showLedger ? (
          <FlatList
            style={styles.mainList}
            data={ledger}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ListHeaderComponent={listHeader}
            ListHeaderComponentStyle={styles.listHeaderWrap}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No transactions on this card.</Text>
              </View>
            }
            renderItem={({ item }) => <LedgerRow transaction={item} styles={styles} />}
          />
        ) : (
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
              onFindTransferCandidates={(t) => getTransferCandidates(db, t)}
              onLinkTransfer={handleLinkTransfer}
              onUnlinkTransfer={handleUnlinkTransfer}
            />
          )}
        />
        )}
      </View>
    </SafeAreaView>
  );
}

function LedgerRow({
  transaction,
  styles,
}: {
  transaction: TransactionWithBalance;
  styles: ReturnType<typeof makeStyles>;
}) {
  const categoryStyle = getCategoryStyle(transaction.categoryName);
  return (
    <View style={[styles.ledgerRow, transaction.ignored && styles.ledgerRowIgnored]}>
      <View style={[styles.ledgerAvatar, { backgroundColor: `${categoryStyle.color}26` }]}>
        <Text style={styles.ledgerAvatarEmoji}>{categoryStyle.emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ledgerMerchant} numberOfLines={1}>
          {formatMerchantName(transaction.merchant)}
        </Text>
        <Text style={styles.ledgerMeta}>{transaction.date}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <AmountText amount={transaction.amount} size="sm" />
        <Text style={styles.ledgerBalance}>balance {formatMoney(transaction.balanceAfter)}</Text>
      </View>
    </View>
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
  ledgerToggleRow: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
  },
  ledgerToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  ledgerToggleBtnActive: { backgroundColor: "#4C1D95" },
  ledgerToggleText: { fontSize: 12.5, fontWeight: "700", color: colors.textSecondary },
  ledgerToggleTextActive: { color: "#FFFFFF" },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ledgerRowIgnored: { opacity: 0.55 },
  ledgerAvatar: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  ledgerAvatarEmoji: { fontSize: 15 },
  ledgerMerchant: { fontSize: 13.5, fontWeight: "600", color: colors.textPrimary },
  ledgerMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  ledgerBalance: { fontSize: 10.5, color: colors.textSecondary, marginTop: 2, fontVariant: ["tabular-nums"] },
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
  heroOwed: { fontSize: 13, fontWeight: "700", color: "#FFFFFFE6", marginTop: 2, marginBottom: 4 },
  heroValueMuted: { fontSize: 22, fontWeight: "700", color: "#FFFFFFCC", marginVertical: 4 },
  setBalanceBtn: { alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: spacing.xs },
  setBalanceText: { color: "#4C1D95", fontSize: 13, fontWeight: "700" },
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
  categoryLine: { gap: 6 },
  categoryLineTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  categoryLineName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  categoryLineAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  categoryLinePct: { width: 38, textAlign: "right", fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  categoryBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
  categoryBarFill: { height: 6, borderRadius: 3 },
  paceTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  mainList: { flex: 1 },
  listHeaderWrap: { zIndex: 20 },
  viewToggle: { marginBottom: spacing.md },
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
