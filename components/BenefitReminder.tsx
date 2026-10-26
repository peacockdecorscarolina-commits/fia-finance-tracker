import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getCardOverviews } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const SOON_DAYS = 7;

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Home's nudge for card credits that reset within a week and still have
// money left -- the ones about to be lost.
export function BenefitReminder() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [expiring, setExpiring] = useState<{ label: string; left: number; days: number }[]>([]);

  useFocusEffect(
    useCallback(() => {
      getCardOverviews(db).then((cards) =>
        setExpiring(
          cards
            .flatMap((c) =>
              c.benefits
                .filter((b) => b.left > 0 && b.daysLeft <= SOON_DAYS)
                .map((b) => ({ label: `${b.benefit.name} (${c.account.name})`, left: b.left, days: b.daysLeft }))
            )
            .sort((a, b) => a.days - b.days)
        )
      );
    }, [db])
  );

  if (expiring.length === 0) return null;
  const total = expiring.reduce((sum, e) => sum + e.left, 0);
  const soonest = expiring[0];

  return (
    <Pressable onPress={() => router.push("/summary")} style={styles.card}>
      <View style={styles.icon}>
        <Ionicons name="gift-outline" size={18} color="#B45309" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>
          {formatMoney(total)} in card credits resets soon
        </Text>
        <Text style={styles.text} numberOfLines={2}>
          {formatMoney(soonest.left)} {soonest.label} · {soonest.days === 0 ? "today" : `${soonest.days} day${soonest.days === 1 ? "" : "s"} left`}
          {expiring.length > 1 ? ` · +${expiring.length - 1} more` : ""}
        </Text>
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
      borderWidth: 1.5,
      borderColor: "#FDE68A",
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#FEF3C7",
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  });
}
