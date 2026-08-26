import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { buildTicks, formatAxisLabel } from "../lib/chartAxis";
import { radius } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

type Point = { x: number; y: number };

// Theme-invariant default accent for the line itself.
const ACCENT = "#4C1D95";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

const CHART_HEIGHT = 90;
const TOOLTIP_WIDTH = 90;
const LABEL_WIDTH = 36;

export function LineChart({
  points,
  labels,
  color = ACCENT,
  width: fallbackWidth = 320,
}: {
  points: number[];
  labels?: string[];
  color?: string;
  width?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<number | null>(null);
  // The axis column's width isn't known until it's measured, so a caller-
  // supplied "total chart width" would either overflow (if it didn't
  // account for the axis) or under-use the space. Measuring the plot
  // area's own actual rendered width sidesteps that entirely.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = measuredWidth ?? fallbackWidth;

  function onPlotLayout(e: LayoutChangeEvent) {
    setMeasuredWidth(e.nativeEvent.layout.width);
  }

  if (points.length < 2) {
    return <View style={{ height: CHART_HEIGHT }} />;
  }

  const rawMax = Math.max(...points);
  const rawMin = Math.min(0, Math.min(...points));
  const ticks = buildTicks(rawMax, rawMin);
  const axisMax = ticks[ticks.length - 1];
  const axisMin = ticks[0];
  const axisRange = axisMax - axisMin || 1;

  const stepX = width / (points.length - 1);
  const coords: Point[] = points.map((p, i) => ({
    x: i * stepX,
    y: CHART_HEIGHT - ((p - axisMin) / axisRange) * CHART_HEIGHT,
  }));

  const tooltipLeft =
    selected !== null ? Math.min(Math.max(coords[selected].x - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH) : 0;

  // Filled area under the line, like the reference design -- a flat line
  // alone reads as a plain diagram; the soft gradient wash under it is what
  // makes it read as a "hero" trend chart. clip-path is web-only, which is
  // fine since this app only ships as a web export.
  const areaPoints = coords.map((c) => `${(c.x / width) * 100}% ${(c.y / CHART_HEIGHT) * 100}%`).join(", ");
  const areaClipPath = `polygon(0% 100%, ${areaPoints}, 100% 100%)`;

  return (
    <View style={styles.chartWithAxis}>
      <View style={styles.axisColumn}>
        {[...ticks].reverse().map((tick) => (
          <Text key={tick} style={styles.axisLabel}>
            {formatAxisLabel(tick, axisMax >= 1000)}
          </Text>
        ))}
      </View>

      <View style={styles.plotArea} onLayout={onPlotLayout}>
        <View style={[styles.plot, { width, height: CHART_HEIGHT }]}>
          <View
            style={[
              styles.area,
              { width, height: CHART_HEIGHT, backgroundColor: `${color}29`, clipPath: areaClipPath } as object,
            ]}
          />
          {selected !== null && (
            <View style={[styles.tooltip, { left: tooltipLeft, top: Math.max(coords[selected].y - 40, 0) }]}>
              <Text style={styles.tooltipValue}>{formatMoney(points[selected])}</Text>
              {labels && <Text style={styles.tooltipLabel}>{labels[selected]}</Text>}
            </View>
          )}
          {coords.slice(1).map((c, i) => (
            <View key={i} style={segmentStyle(coords[i], c, color, 2.5)} />
          ))}
          {coords.map((c, i) => (
            <Pressable
              key={`dot-${i}`}
              hitSlop={10}
              onPress={() => setSelected((current) => (current === i ? null : i))}
              style={[styles.dotHit, { left: c.x - 10, top: c.y - 10 }]}
            >
              <View
                style={[
                  styles.dot,
                  selected === i && styles.dotSelected,
                  { backgroundColor: color },
                ]}
              />
            </Pressable>
          ))}
        </View>
        {labels && (
          <View style={[styles.labelRow, { width }]}>
            {labels.map((l, i) => (
              <Text
                key={i}
                style={[
                  styles.label,
                  {
                    position: "absolute",
                    left: Math.min(Math.max(coords[i].x - LABEL_WIDTH / 2, 0), width - LABEL_WIDTH),
                    width: LABEL_WIDTH,
                  },
                  selected === i && styles.labelSelected,
                ]}
              >
                {l}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    chartWithAxis: { flexDirection: "row" },
    axisColumn: {
      height: CHART_HEIGHT,
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginRight: 6,
    },
    axisLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: "600" },
    plotArea: { flex: 1 },
    plot: {
      borderLeftWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    area: { position: "absolute", left: 0, top: 0 },
    dotHit: { position: "absolute", width: 20, height: 20, alignItems: "center", justifyContent: "center" },
    dot: { width: 6, height: 6, borderRadius: 3 },
    dotSelected: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "#FFFFFF" },
    tooltip: {
      position: "absolute",
      width: TOOLTIP_WIDTH,
      backgroundColor: colors.card,
      borderRadius: radius.chip,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 4,
      paddingHorizontal: 6,
      alignItems: "center",
      zIndex: 10,
    },
    tooltipValue: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
    tooltipLabel: { fontSize: 10, color: colors.textSecondary },
    labelRow: { height: 14, marginTop: 6 },
    label: { fontSize: 11, color: colors.textSecondary, fontWeight: "600", textAlign: "center" },
    labelSelected: { color: colors.textPrimary, fontWeight: "700" },
  });
}
