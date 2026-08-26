import { StyleSheet, Text, View } from "react-native";
import { radius } from "../lib/theme";

// Matches the rest of the app's redesigned screens -- these tinted badge
// colors stay fixed across light/dark mode, same as category-color chips.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const POSITIVE = "#16A34A";
const POSITIVE_LIGHT = "#DCFCE7";

export function Chip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  return (
    <View style={[styles.base, toneStyles[tone].container]}>
      <Text style={[styles.label, toneStyles[tone].label]}>{label}</Text>
    </View>
  );
}

const toneStyles = {
  neutral: StyleSheet.create({
    container: { backgroundColor: ACCENT_LIGHT },
    label: { color: ACCENT },
  }),
  positive: StyleSheet.create({
    container: { backgroundColor: POSITIVE_LIGHT },
    label: { color: POSITIVE },
  }),
  warning: StyleSheet.create({
    container: { backgroundColor: "#FEF3C7" },
    label: { color: "#B45309" },
  }),
};

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.chip,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
