import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { checkInMonth, checkInStreak } from "../lib/checkIn";
import { getCheckInsDone, getStatementStatuses, todayISO } from "../lib/db";
import { useTheme } from "../lib/ThemeContext";

const FLAME = "#F97316";
const LOST = "#94A3B8";

// The header's monthly check-in streak: an orange flame with the number of
// months in a row, grey at 0 once it's lost (or before the first). Opens the
// check-in. Hidden until something has been uploaded.
export function StreakBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const [streak, setStreak] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      const today = todayISO();
      Promise.all([getStatementStatuses(db, today), getCheckInsDone(db)]).then(([statuses, done]) => {
        setStreak(statuses.some((s) => s.nextExpected !== null) ? checkInStreak(done, checkInMonth(today)) : null);
      });
    }, [db])
  );

  if (streak === null) return null;
  const lit = streak > 0;

  return (
    <Pressable
      onPress={() => router.push("/check-in")}
      style={[style, styles.badge]}
      accessibilityLabel={lit ? `${streak} month check-in streak` : "Check-in streak lost"}
    >
      <Ionicons name={lit ? "flame" : "flame-outline"} size={17} color={lit ? FLAME : LOST} />
      <Text style={[styles.count, { color: lit ? colors.textPrimary : LOST }]}>{streak}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", gap: 1, width: undefined, minWidth: 40, paddingHorizontal: 7 },
  count: { fontSize: 13, fontWeight: "800" },
});
