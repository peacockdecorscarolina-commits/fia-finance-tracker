import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../lib/theme";

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
    container: { backgroundColor: colors.accentBg },
    label: { color: colors.accent },
  }),
  positive: StyleSheet.create({
    container: { backgroundColor: colors.positiveBg },
    label: { color: colors.positive },
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
