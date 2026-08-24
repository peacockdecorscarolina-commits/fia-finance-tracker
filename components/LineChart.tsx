import { StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

type Point = { x: number; y: number };

function segmentStyle(from: Point, to: Point, color: string, strokeWidth: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    position: "absolute" as const,
    left: from.x,
    top: from.y - strokeWidth / 2,
    width: length,
    height: strokeWidth,
    backgroundColor: color,
    borderRadius: strokeWidth / 2,
    transform: [{ rotate: `${angleDeg}deg` }],
    transformOrigin: "0 0" as const,
  };
}

export function LineChart({
  points,
  labels,
  color = colors.accent,
  width = 320,
  height = 100,
}: {
  points: number[];
  labels?: string[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return <View style={{ width, height }} />;
  }
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const padding = 6;
  const usableHeight = height - padding * 2;
  const stepX = width / (points.length - 1);
  const coords: Point[] = points.map((p, i) => ({
    x: i * stepX,
    y: padding + usableHeight - ((p - min) / range) * usableHeight,
  }));

  return (
    <View>
      <View style={{ width, height }}>
        {coords.slice(1).map((c, i) => (
          <View key={i} style={segmentStyle(coords[i], c, color, 2.5)} />
        ))}
        {coords.map((c, i) => (
          <View
            key={`dot-${i}`}
            style={[styles.dot, { left: c.x - 3, top: c.y - 3, backgroundColor: color }]}
          />
        ))}
      </View>
      {labels && (
        <View style={styles.labelRow}>
          {labels.map((l, i) => (
            <Text key={i} style={styles.label}>
              {l}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: "absolute", width: 6, height: 6, borderRadius: 3 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  label: { fontSize: 10, color: colors.textSecondary },
});
