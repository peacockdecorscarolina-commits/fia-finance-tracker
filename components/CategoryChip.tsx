import { StyleSheet, Text, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { radius } from "../lib/theme";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function CategoryChip({ name }: { name: string }) {
  const { emoji, color } = getCategoryStyle(name);
  return (
    <View style={[styles.base, { backgroundColor: hexToRgba(color, 0.12) }]}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.label, { color }]}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.chip,
    alignSelf: "flex-start",
  },
  emoji: { fontSize: 12 },
  label: { fontSize: 12, fontWeight: "600" },
});
