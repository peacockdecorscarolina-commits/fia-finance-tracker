import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";

type Slice = { name: string; value: number; color: string; emoji: string | null };

// Relative luminance (WCAG formula) so slice labels pick white or dark ink
// depending on how light the slice's own color is, instead of a fixed color
// that goes illegible on light categorical hues (yellow, aqua, etc).
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const [R, G, B] = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function textColorFor(bg: string): string {
  return luminance(bg) > 0.5 ? "#1F2937" : "#FFFFFF";
}

const SIZE = 170;
const CENTER = SIZE / 2;
// Only label slices big enough for a "12%" to sit inside comfortably --
// smaller slices are still identifiable via the legend + swatch.
const MIN_LABEL_PCT = 8;

export function PieChart({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  let cumulative = 0;
  const stops = slices.map((s) => {
    const startPct = (cumulative / total) * 100;
    cumulative += s.value;
    const endPct = (cumulative / total) * 100;
    return `${s.color} ${startPct}% ${endPct}%`;
  });
  const gradient = `conic-gradient(${stops.join(", ")})`;

  let angleCursor = 0;
  const labels = slices.map((s) => {
    const pct = (s.value / total) * 100;
    const midFraction = (angleCursor + s.value / 2) / total;
    angleCursor += s.value;
    const angleRad = (midFraction * 360 - 90) * (Math.PI / 180);
    const labelRadius = CENTER * 0.65;
    return {
      pct,
      x: CENTER + labelRadius * Math.cos(angleRad),
      y: CENTER + labelRadius * Math.sin(angleRad),
      color: s.color,
    };
  });

  return (
    <View style={styles.row}>
      <View style={[styles.pie, { backgroundImage: gradient } as object]}>
        {labels
          .filter((l) => l.pct >= MIN_LABEL_PCT)
          .map((l, i) => (
            <Text
              key={i}
              style={[styles.sliceLabel, { left: l.x - 18, top: l.y - 8, color: textColorFor(l.color) }]}
            >
              {Math.round(l.pct)}%
            </Text>
          ))}
      </View>
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.name} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendText} numberOfLines={1}>
              {s.emoji ? `${s.emoji} ` : ""}
              {s.name}
            </Text>
            <Text style={styles.legendPct}>{Math.round((s.value / total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  pie: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  sliceLabel: { position: "absolute", width: 36, textAlign: "center", fontSize: 12, fontWeight: "700" },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: "600" },
  legendPct: { fontSize: 12, color: colors.textSecondary, fontWeight: "700" },
});
