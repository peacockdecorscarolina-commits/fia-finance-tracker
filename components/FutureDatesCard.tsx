import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { autoBackup } from "../lib/autoBackup";
import { getFutureDated, keepFutureDates, moveFutureDatesBack, todayISO, type FutureDated } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

function longDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Home's nudge when transactions are dated after today -- usually a
// statement whose year was misread -- with a one-tap fix.
export function FutureDatesCard({ onChanged }: { onChanged?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [list, setList] = useState<FutureDated[]>([]);

  const load = useCallback(() => {
    getFutureDated(db, todayISO()).then(setList);
  }, [db]);
  useFocusEffect(load);

  async function moveBack(f: FutureDated) {
    await moveFutureDatesBack(db, f.accountId, todayISO());
    autoBackup(db);
    load();
    onChanged?.();
  }

  async function keep(f: FutureDated) {
    await keepFutureDates(db, f.ids);
    load();
  }

  if (list.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      {list.map((f) => (
        <View key={f.accountId} style={styles.card}>
          <View style={styles.top}>
            <Ionicons name="calendar-outline" size={18} color="#B45309" />
            <Text style={styles.title}>
              {f.count} {f.accountName} transaction{f.count === 1 ? " is" : "s are"} dated in the future
            </Text>
          </View>
          <Text style={styles.text}>
            The latest is {longDate(f.latest)}. That usually means the statement{"'"}s year was read wrong. Move {f.count === 1 ? "it" : "them"} back a year?
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={() => moveBack(f)} style={styles.primary} accessibilityLabel={`Move ${f.accountName} dates back a year`}>
              <Text style={styles.primaryText}>Move back a year</Text>
            </Pressable>
            <Pressable onPress={() => keep(f)} style={styles.secondary} accessibilityLabel={`Keep ${f.accountName} dates`}>
              <Text style={styles.secondaryText}>{"They're right"}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm, borderWidth: 1.5, borderColor: "#F59E0B" },
    top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    title: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    actions: { flexDirection: "row", gap: spacing.sm },
    primary: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: "#4C1D95" },
    primaryText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
    secondary: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    secondaryText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  });
}
