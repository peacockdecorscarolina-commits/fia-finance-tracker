import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getFlaggedCount } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Home's nudge when an upload turned up something on the watch list.
export function WatchFoundCard() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      getFlaggedCount(db).then(setCount);
    }, [db])
  );

  if (count === 0) return null;
  return (
    <Pressable onPress={() => router.push("/watch-list")} style={styles.card}>
      <View style={styles.icon}>
        <Text style={{ fontSize: 16 }}>👀</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>
          Found {count} transaction{count === 1 ? "" : "s"} you were watching for
        </Text>
        <Text style={styles.text}>Tap to check {count === 1 ? "it's" : "they're"} the right one</Text>
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
      borderColor: "#F59E0B",
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
    text: { fontSize: 12, color: colors.textSecondary },
  });
}
