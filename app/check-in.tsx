import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { checkInMonth, checkInStreak, previousMonth, statementsDone } from "../lib/checkIn";
import {
  getCardPaymentsTotal,
  getCategorySummary,
  getCheckInsDone,
  getIncomeExpenseTotals,
  getNeedsReviewCount,
  getStatementStatuses,
  markCheckInDone,
  todayISO,
  type CategoryTotal,
} from "../lib/db";
import { periodRange } from "../lib/period";
import { describeStatementStatus, monthName, type StatementStatus } from "../lib/statementReminders";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const ACCENT = "#4C1D95";
const SUCCESS = "#16A34A";

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

type Recap = {
  spent: number;
  spentBefore: number;
  income: number;
  paidToCards: number;
  top: CategoryTotal[];
};

export default function CheckInScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const today = todayISO();
  const month = checkInMonth(today);
  const label = monthName(month, month.slice(0, 4) !== today.slice(0, 4));
  const [waiting, setWaiting] = useState<{ status: StatementStatus; line: string }[]>([]);
  const [statementsIn, setStatementsIn] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [doneMonths, setDoneMonths] = useState<string[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const statuses = await getStatementStatuses(db, today);
    setStatementsIn(statementsDone(statuses, month));
    setWaiting(
      statuses
        .filter((s) => [...s.readyMonths, ...s.missingMonths].some((m) => m <= month))
        .map((s) => ({ status: s, line: describeStatementStatus(s, today) ?? "" }))
    );
    setReviewCount(await getNeedsReviewCount(db));
    setDoneMonths(await getCheckInsDone(db));
    const { start, end } = periodRange(month);
    const before = periodRange(previousMonth(month));
    const [totals, totalsBefore, paidToCards, categories] = await Promise.all([
      getIncomeExpenseTotals(db, { start, end }),
      getIncomeExpenseTotals(db, { start: before.start, end: before.end }),
      getCardPaymentsTotal(db, start, end),
      getCategorySummary(db, month),
    ]);
    setRecap({
      spent: totals.expenses,
      spentBefore: totalsBefore.expenses,
      income: totals.income,
      paidToCards,
      top: [...categories].sort((a, b) => b.total - a.total).filter((c) => c.total > 0).slice(0, 3),
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

  async function finish() {
    await markCheckInDone(db, month);
    load();
  }

  function addToCalendar() {
    if (Platform.OS === "web") window.location.href = "/api/check-in-calendar";
    else Linking.openURL("https://fia-finance-tracker.vercel.app/api/check-in-calendar");
  }

  const change = recap && recap.spentBefore > 0 ? ((recap.spent - recap.spentBefore) / recap.spentBefore) * 100 : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>{label} check-in</Text>
          <View style={styles.headerBtn} />
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroTitle}>{finished ? `${label} is all wrapped up 🎉` : `Wrap up ${label}`}</Text>
          <Text style={styles.heroText}>
            {finished
              ? "Your numbers for the month are complete."
              : "Once a month: get last month's statements in, sort anything new, and see how the month went. About 5 minutes."}
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
          <StepTitle done={statementsIn} title="1. Upload statements" styles={styles} />
          {statementsIn ? (
            <Text style={styles.stepText}>Every account is up to date through {label}.</Text>
          ) : (
            waiting.map(({ status, line }) => (
              <View key={status.accountId} style={styles.waitingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.waitingName} numberOfLines={1}>
                    {status.accountName}
                  </Text>
                  <Text style={styles.stepText}>{line}</Text>
                </View>
                <Pressable
                  onPress={() => router.push({ pathname: "/upload", params: { accountId: String(status.accountId) } })}
                  style={styles.smallBtn}
                >
                  <Text style={styles.smallBtnText}>Upload</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

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

        <View style={styles.stepCard}>
          <StepTitle done={finished} title={`3. Your ${label} recap`} styles={styles} />
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
                <View style={styles.recapBox}>
                  <Text style={styles.recapLabel}>Paid to cards</Text>
                  <Text style={styles.recapValue}>{formatMoney(recap.paidToCards)}</Text>
                </View>
              </View>
              {recap.top.length > 0 && (
                <>
                  <Text style={styles.recapSubtitle}>Where most of it went</Text>
                  {recap.top.map((c) => (
                    <View key={c.categoryName} style={styles.topRow}>
                      <Text style={styles.topName}>
                        {getCategoryStyle(c.categoryName).emoji} {c.categoryName}
                      </Text>
                      <Text style={styles.topAmount}>{formatMoney(c.total)}</Text>
                    </View>
                  ))}
                </>
              )}
              {!statementsIn && (
                <Text style={styles.note}>Some statements aren't in yet, so these numbers may be short.</Text>
              )}
            </>
          )}
          {!finished && (
            <Pressable onPress={finish} style={styles.finishWrap}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.finishBtn}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                <Text style={styles.finishText}>Finish {label} check-in</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
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
  topRow: { flexDirection: "row", justifyContent: "space-between" },
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
