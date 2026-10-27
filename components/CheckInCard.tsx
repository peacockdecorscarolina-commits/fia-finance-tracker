import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { checkInMonth, checkInStreak, statementsDone } from "../lib/checkIn";
import { getCheckInsDone, getNeedsReviewCount, getStatementStatuses, todayISO } from "../lib/db";
import { monthName } from "../lib/statementReminders";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const SUCCESS = "#16A34A";
const STEPS = 3;

// Home's entry to the monthly check-in: how far this month's has got, and
// the streak. Hidden until something has been uploaded.
export function CheckInCard() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [state, setState] = useState<{ month: string; done: number; finished: boolean; streak: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      const today = todayISO();
      const month = checkInMonth(today);
      Promise.all([getStatementStatuses(db, today), getNeedsReviewCount(db), getCheckInsDone(db)]).then(
        ([statuses, reviewCount, doneMonths]) => {
          if (!statuses.some((s) => s.nextExpected !== null)) {
            setState(null);
            return;
          }
          const finished = doneMonths.includes(month);
          const done = finished
            ? STEPS
            : (statementsDone(statuses, month) ? 1 : 0) + (reviewCount === 0 ? 1 : 0);
          setState({ month, done, finished, streak: checkInStreak(doneMonths, month) });
        }
      );
    }, [db])
  );

  if (!state) return null;
  const label = monthName(state.month);

  return (
    <Pressable onPress={() => router.push("/check-in")} style={styles.card}>
      <View style={[styles.icon, state.finished && { backgroundColor: "#DCFCE7" }]}>
        <Ionicons
          name={state.finished ? "checkmark-done-outline" : "calendar-outline"}
          size={18}
          color={state.finished ? SUCCESS : ACCENT}
        />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title}>
          {state.finished ? `${label} check-in done` : `${label} check-in · ${state.done} of ${STEPS} done`}
        </Text>
        {!state.finished && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(state.done / STEPS) * 100}%` }]} />
          </View>
        )}
        {state.streak > 0 && (
          <Text style={styles.text}>
            🔥 {state.streak} month{state.streak === 1 ? "" : "s"} in a row
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#EDE9FE",
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 12, color: colors.textSecondary },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3, backgroundColor: ACCENT },
  });
}
