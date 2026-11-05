import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { accountMonthState, checkInMonth, checkInStreak, CHECK_IN_DAY, previousMonth, statementsDone, upcomingStatements, type AccountMonthState } from "../lib/checkIn";
import {
  getCardPaymentsTotal,
  getCategorySummary,
  getCheckInsDone,
  getIncomeExpenseTotals,
  getIncomeSources,
  getMonthInsights,
  getNeedsReviewCount,
  getStatementStatuses,
  getTransactions,
  markCheckInDone,
  PAYMENT_CATEGORY_NAME,
  todayISO,
  type CategoryTotal,
} from "../lib/db";
import { periodRange, shiftMonth } from "../lib/period";
import { formatMerchantName } from "../lib/formatMerchant";
import { monthName, type StatementStatus } from "../lib/statementReminders";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const ACCENT = "#4C1D95";
const SUCCESS = "#16A34A";
const DANGER = "#DC2626";
const WAITING = "#B45309";

const STATE_ICON: Record<AccountMonthState["kind"], { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  closed: { name: "checkmark-circle", color: SUCCESS },
  upToDate: { name: "checkmark-circle", color: SUCCESS },
  waiting: { name: "time-outline", color: WAITING },
  ready: { name: "cloud-upload-outline", color: ACCENT },
  missing: { name: "alert-circle", color: DANGER },
};

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

type Recap = {
  spent: number;
  spentBefore: number;
  income: number;
  paidToCards: number;
  count: number;
  top: (CategoryTotal & { before: number })[];
  biggest: { id: number; merchant: string; accountName: string; date: string; amount: number }[];
  incomeSources: { key: string; name: string; total: number }[];
  insights: { emoji: string; text: string }[];
};

export default function CheckInScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const today = todayISO();
  const openMonth = checkInMonth(today);
  // ‹ › steps back through past months' check-ins; only the open one can be finished.
  const [month, setMonth] = useState(openMonth);
  const [earliestMonth, setEarliestMonth] = useState(openMonth);
  const isOpen = month === openMonth;
  // Months after the open one (the one in progress and the next) show when
  // their statements are due; their check-ins haven't opened yet.
  const isUpcoming = month > openMonth;
  const lastViewable = shiftMonth(today.slice(0, 7), 1);
  const opensOn = new Date(`${shiftMonth(month, 1)}-0${CHECK_IN_DAY}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const started = month <= today.slice(0, 7);
  const label = monthName(month, month.slice(0, 4) !== today.slice(0, 4));
  const [accountStates, setAccountStates] = useState<{ status: StatementStatus; state: AccountMonthState }[]>([]);
  const [statementsIn, setStatementsIn] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [doneMonths, setDoneMonths] = useState<string[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The per-account list can be long; it stays folded behind a summary.
  const [statementsOpen, setStatementsOpen] = useState(false);

  const load = useCallback(async () => {
    const statuses = await getStatementStatuses(db, today);
    setStatementsIn(statementsDone(statuses, month));
    const firsts = statuses.map((s) => s.firstDate).filter((d): d is string => d !== null).sort();
    if (firsts[0]) setEarliestMonth(firsts[0].slice(0, 7) < openMonth ? firsts[0].slice(0, 7) : openMonth);
    setAccountStates(
      statuses.flatMap((s) => {
        const state = month > openMonth ? upcomingStatements(s, month, today) : accountMonthState(s, month, today);
        return state ? [{ status: s, state }] : [];
      })
    );
    setReviewCount(await getNeedsReviewCount(db));
    setDoneMonths(await getCheckInsDone(db));
    const { start, end } = periodRange(month);
    const before = periodRange(previousMonth(month));
    const [totals, totalsBefore, paidToCards, categories, categoriesBefore, transactions, sources, insights] = await Promise.all([
      getIncomeExpenseTotals(db, { start, end }),
      getIncomeExpenseTotals(db, { start: before.start, end: before.end }),
      getCardPaymentsTotal(db, start, end),
      getCategorySummary(db, month),
      getCategorySummary(db, previousMonth(month)),
      getTransactions(db, { start, end, excludeIncome: true, excludeCategoryNames: [PAYMENT_CATEGORY_NAME] }),
      getIncomeSources(db, start, end, today),
      getMonthInsights(db, month),
    ]);
    const beforeByName = new Map(categoriesBefore.map((c) => [c.categoryName, c.total]));
    const spending = transactions
      .filter((t) => t.amount < 0 && !t.ignored)
      .map((t) => ({ id: t.id, merchant: t.merchant, accountName: t.accountName, date: t.date, amount: -t.amount - (t.reimbursed ?? 0) }));
    setRecap({
      spent: totals.expenses,
      spentBefore: totalsBefore.expenses,
      income: totals.income,
      paidToCards,
      count: spending.length,
      top: [...categories]
        .sort((a, b) => b.total - a.total)
        .filter((c) => c.total > 0)
        .slice(0, 5)
        .map((c) => ({ ...c, before: beforeByName.get(c.categoryName) ?? 0 })),
      biggest: spending.sort((a, b) => b.amount - a.amount).slice(0, 3),
      incomeSources: sources.filter((s) => s.total > 0).map((s) => ({ key: s.key, name: s.name, total: s.total })),
      // A month still going has nothing settled to compare yet.
      insights: month > openMonth ? [] : insights,
    });
    setLoaded(true);
  }, [db, month, today]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const finished = doneMonths.includes(month);
  const streak = checkInStreak(doneMonths, month);
  const reviewDone = reviewCount === 0;

  // Statements have to be in -- that's what makes the month's numbers right,
  // so the streak can't be kept without them. Sorting is optional.
  async function finish() {
    if (!statementsIn || !isOpen) return;
    await markCheckInDone(db, month);
    load();
  }

  function addToCalendar() {
    if (Platform.OS === "web") window.location.href = "/api/check-in-calendar";
    else Linking.openURL("https://fia-finance-tracker.vercel.app/api/check-in-calendar");
  }

  // A month still in progress would always look like a big drop.
  const change = recap && recap.spentBefore > 0 && !isUpcoming ? ((recap.spent - recap.spentBefore) / recap.spentBefore) * 100 : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Monthly check-in</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.monthSwitch}>
          <Pressable
            onPress={() => setMonth(previousMonth(month))}
            disabled={month <= earliestMonth}
            style={[styles.monthArrow, month <= earliestMonth && { opacity: 0.3 }]}
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={styles.monthLabel}>{label}</Text>
            <Text style={styles.monthSub}>
              {isOpen ? "Open now" : isUpcoming ? `Opens ${opensOn}` : finished ? "✅ Finished" : "✗ Not finished"}
            </Text>
          </View>
          <Pressable
            onPress={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= lastViewable}
            style={[styles.monthArrow, month >= lastViewable && { opacity: 0.3 }]}
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroTitle}>
            {finished
              ? `${label} is all wrapped up 🎉`
              : isOpen
                ? `Wrap up ${label}`
                : isUpcoming
                  ? `${label} check-in opens ${opensOn}`
                  : `${label} wasn't finished`}
          </Text>
          <Text style={styles.heroText}>
            {finished
              ? "Your numbers for the month are complete."
              : isOpen
                ? "Once a month: get last month's statements in, sort anything new, and see how the month went. About 5 minutes."
                : isUpcoming
                  ? `Here's when the statements that make up ${monthName(month)} come out.`
                  : "Its check-in closed before it was finished. You can still upload its statements to fill in the numbers."}
          </Text>
          {streak > 0 && (
            <View style={styles.streakPill}>
              <Text style={styles.streakText}>🔥 {streak} month{streak === 1 ? "" : "s"} in a row</Text>
            </View>
          )}
        </LinearGradient>

        {loaded && (
        <>
        <View style={styles.stepCard}>
          <StepTitle done={statementsIn} title={`1. ${label} statements`} styles={styles} />
          <Pressable onPress={() => setStatementsOpen((v) => !v)} style={styles.summaryRow}>
            <Text style={[styles.stepText, { flex: 1 }]}>
              {statementsIn ? `Every account is in for ${label}` : statementSummary(accountStates.map((a) => a.state), isUpcoming)}
            </Text>
            <Text style={styles.summaryToggle}>{statementsOpen ? "Hide" : `Show ${accountStates.length}`}</Text>
            <Ionicons name={statementsOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.accent} />
          </Pressable>
          {statementsOpen && accountStates.map(({ status, state }) => {
            const icon = STATE_ICON[state.kind];
            // A future month's statements get Upload once they should be out.
            const needsUpload = isUpcoming
              ? state.line.includes("should be out now")
              : state.kind === "missing" || state.kind === "ready" || state.kind === "waiting";
            return (
              <View key={status.accountId} style={styles.waitingRow}>
                <Ionicons name={icon.name} size={18} color={icon.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.waitingName} numberOfLines={1}>
                    {status.accountName}
                  </Text>
                  <Text style={styles.stepText}>{state.line}</Text>
                </View>
                {needsUpload && (
                  <Pressable
                    onPress={() => router.push({ pathname: "/upload", params: { accountId: String(status.accountId) } })}
                    style={styles.smallBtn}
                  >
                    <Text style={styles.smallBtnText}>Upload</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        {isOpen && (
        <View style={styles.stepCard}>
          <StepTitle done={reviewDone} title="2. Sort new transactions" styles={styles} />
          {reviewDone ? (
            <Text style={styles.stepText}>Nothing is waiting for a category.</Text>
          ) : (
            <View style={styles.waitingRow}>
              <Text style={[styles.stepText, { flex: 1 }]}>
                {reviewCount} transaction{reviewCount === 1 ? "" : "s"} need{reviewCount === 1 ? "s" : ""} a category.
              </Text>
              <Pressable onPress={() => router.push("/review")} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Review</Text>
              </Pressable>
            </View>
          )}
        </View>
        )}

        {started && (
        <View style={styles.stepCard}>
          <StepTitle
            done={finished}
            title={isOpen ? `3. Your ${label} recap` : isUpcoming ? `2. Your ${label} so far` : `2. Your ${label} recap`}
            styles={styles}
          />
          {recap && (
            <>
              <View style={styles.recapRow}>
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Spent</Text>
                  <Text style={styles.recapValue}>{formatMoney(recap.spent)}</Text>
                  {change !== null && (
                    <Text style={[styles.recapChange, { color: change <= 0 ? SUCCESS : "#DC2626" }]}>
                      {change <= 0 ? "▼" : "▲"} {Math.abs(change).toFixed(0)}% vs {monthName(previousMonth(month))}
                    </Text>
                  )}
                </View>
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Income</Text>
                  <Text style={styles.recapValue}>{formatMoney(recap.income)}</Text>
                </View>
              </View>
              <View style={styles.recapRow}>
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Net</Text>
                  <Text style={[styles.recapValue, { color: recap.income - recap.spent >= 0 ? SUCCESS : DANGER }]}>
                    {recap.income - recap.spent < 0 ? "-" : ""}
                    {formatMoney(Math.abs(recap.income - recap.spent))}
                  </Text>
                </View>
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Paid to cards</Text>
                  <Text style={styles.recapValue}>{formatMoney(recap.paidToCards)}</Text>
                </View>
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Purchases</Text>
                  <Text style={styles.recapValue}>{recap.count.toLocaleString()}</Text>
                </View>
              </View>
              {recap.insights.length > 0 && (
                <>
                  <Text style={styles.recapSubtitle}>What stood out</Text>
                  {recap.insights.map((i) => (
                    <View key={i.text} style={styles.insightRow}>
                      <Text style={styles.insightEmoji}>{i.emoji}</Text>
                      <Text style={styles.insightText}>{i.text}</Text>
                    </View>
                  ))}
                </>
              )}
              {recap.incomeSources.length > 1 && (
                <>
                  <Text style={styles.recapSubtitle}>Where income came from</Text>
                  {recap.incomeSources.slice(0, 3).map((s) => (
                    <Pressable
                      key={s.key}
                      onPress={() => router.push({ pathname: "/income", params: { period: month } })}
                      style={styles.topRow}
                    >
                      <Text style={styles.topName} numberOfLines={1}>
                        💵 {s.name}
                      </Text>
                      <Text style={styles.topAmount}>{formatMoney(s.total)}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {recap.top.length > 0 && (
                <>
                  <Text style={styles.recapSubtitle}>Where it went</Text>
                  {recap.top.map((c) => {
                    const diff = c.total - c.before;
                    const style = getCategoryStyle(c.categoryName);
                    return (
                      <Pressable
                        key={c.categoryName}
                        onPress={() => router.push({ pathname: "/category/[name]", params: { name: c.categoryName, month } })}
                        style={styles.topItem}
                      >
                        <View style={styles.topRow}>
                          <Text style={styles.topName}>
                            {style.emoji} {c.categoryName}
                          </Text>
                          <Text style={styles.topAmount}>{formatMoney(c.total)}</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View
                            style={[styles.barFill, { width: `${(c.total / recap.top[0].total) * 100}%`, backgroundColor: style.color }]}
                          />
                        </View>
                        {c.before > 0 && Math.round(diff) !== 0 && (
                          <Text style={[styles.topChange, { color: diff <= 0 ? SUCCESS : DANGER }]}>
                            {diff <= 0 ? "▼" : "▲"} {formatMoney(Math.abs(diff))} vs {monthName(previousMonth(month))}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {recap.biggest.length > 0 && (
                <>
                  <Text style={styles.recapSubtitle}>Biggest purchases</Text>
                  {recap.biggest.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => router.push({ pathname: "/merchant/[name]", params: { name: t.merchant } })}
                      style={styles.topRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.topName} numberOfLines={1}>
                          {formatMerchantName(t.merchant)}
                        </Text>
                        <Text style={styles.biggestMeta}>
                          {t.accountName} ·{" "}
                          {new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </Text>
                      </View>
                      <Text style={styles.topAmount}>{formatMoney(t.amount)}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {!statementsIn && (
                <Text style={styles.note}>Some statements aren't in yet, so these numbers may be short.</Text>
              )}
            </>
          )}
          {!finished && isOpen && (
            <Pressable onPress={finish} disabled={!statementsIn} style={[styles.finishWrap, !statementsIn && { opacity: 0.5 }]}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.finishBtn}>
                <Ionicons name={statementsIn ? "checkmark-circle-outline" : "lock-closed-outline"} size={16} color="#FFFFFF" />
                <Text style={styles.finishText}>
                  {statementsIn ? `Finish ${label} check-in` : "Upload your statements to finish"}
                </Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
        )}
        </>
        )}

        <Pressable onPress={addToCalendar} style={styles.calendarCard}>
          <Ionicons name="calendar-outline" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.calendarTitle}>Add a monthly reminder to your calendar</Text>
            <Text style={styles.stepText}>On the 2nd of every month at 9 AM, with a link back here.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// "2 in · 1 waiting · 1 missing" for the folded statements list.
function statementSummary(states: AccountMonthState[], upcoming: boolean): string {
  const count = (kinds: AccountMonthState["kind"][]) => states.filter((s) => kinds.includes(s.kind)).length;
  const parts = [
    [count(["closed", "upToDate"]), "in"],
    [count(["waiting"]), upcoming ? "coming up" : "waiting"],
    [count(["ready"]), "ready to upload"],
    [count(["missing"]), "missing"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(" · ");
}

function StepTitle({ done, title, styles }: { done: boolean; title: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stepTitleRow}>
      <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={20} color={done ? SUCCESS : "#94A3B8"} />
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  heroTitle: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  heroText: { fontSize: 13, color: "#FFFFFFE6", lineHeight: 19 },
  streakPill: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF26",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  streakText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  stepCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  stepTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  stepText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.chip,
    padding: spacing.sm,
  },
  waitingName: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  smallBtn: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  smallBtnText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
  recapRow: { flexDirection: "row", gap: spacing.sm },
  recapBox: { flex: 1, backgroundColor: colors.background, borderRadius: radius.chip, padding: spacing.sm, gap: 2 },
  recapLabel: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },
  recapValue: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  recapChange: { fontSize: 11, fontWeight: "700" },
  recapSubtitle: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, marginTop: spacing.xs },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  topItem: { gap: 4 },
  insightRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  insightEmoji: { fontSize: 15 },
  insightText: { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  topChange: { fontSize: 11, fontWeight: "700" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  biggestMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryToggle: { fontSize: 13, fontWeight: "700", color: colors.accent },
  monthSwitch: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  monthArrow: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  monthLabel: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  monthSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  topName: { fontSize: 14, color: colors.textPrimary },
  topAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  note: { fontSize: 12, color: "#B45309", lineHeight: 17 },
  finishWrap: { borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.xs },
  finishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  finishText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  calendarCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  calendarTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  });
}
