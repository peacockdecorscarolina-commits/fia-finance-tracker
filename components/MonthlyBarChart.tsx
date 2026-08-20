import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";
import type { MonthlyTotal } from "../lib/db";

function formatMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

// Picks a "clean" tick spacing (1, 2, or 5 times a power of ten) so the
// axis reads e.g. "0k / 1k / 2k / 3k" with round numbers, aiming for
// roughly 4-5 gridlines.
function niceStep(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const roughStep = rawMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const steps = [1, 2, 5, 10];
  const step = steps.find((s) => roughStep <= s * magnitude) ?? 10;
  return step * magnitude;
}

// Builds the tick values from 0 up to (and including) a ceiling that's a
// whole number of steps above the raw max, so the top gridline is never
// below the tallest bar.
function buildTicks(rawMax: number): number[] {
  const step = niceStep(rawMax);
  const topTick = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= topTick; v += step) ticks.push(v);
  return ticks;
}

function formatAxisLabel(value: number, useK: boolean): string {
  if (useK) {
    const thousands = value / 1000;
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

const CHART_HEIGHT = 120;

export function MonthlyBarChart({
  data,
  selectedMonth,
  onSelectMonth,
}: {
  data: MonthlyTotal[];
  selectedMonth?: string | null;
  onSelectMonth?: (month: string) => void;
}) {
  const rawMax = Math.max(...data.flatMap((d) => [d.income, d.expenses]), 1);
  const ticks = buildTicks(rawMax);
  const axisMax = ticks[ticks.length - 1];

  return (
    <View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.positive }]} />
          <Text style={styles.legendText}>Income</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.negative }]} />
          <Text style={styles.legendText}>Expenses</Text>
        </View>
      </View>

      {data.length === 0 ? (
        <Text style={styles.empty}>No transactions yet.</Text>
      ) : (
        <View style={styles.chartWithAxis}>
          <View style={styles.axisColumn}>
            {[...ticks].reverse().map((tick) => (
              <Text key={tick} style={styles.axisLabel}>
                {formatAxisLabel(tick, axisMax >= 1000)}
              </Text>
            ))}
          </View>

          <View style={styles.plotArea}>
            <View style={styles.barsRow}>
              {data.map((item) => (
                <Pressable
                  key={item.month}
                  style={[styles.monthCol, selectedMonth === item.month && styles.monthColSelected]}
                  onPress={onSelectMonth ? () => onSelectMonth(item.month) : undefined}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max((item.income / axisMax) * CHART_HEIGHT, 2),
                        backgroundColor: colors.positive,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max((item.expenses / axisMax) * CHART_HEIGHT, 2),
                        backgroundColor: colors.negative,
                      },
                    ]}
                  />
                </Pressable>
              ))}
            </View>
            <View style={styles.monthLabelsRow}>
              {data.map((item) => (
                <Text
                  key={item.month}
                  style={[styles.monthLabel, selectedMonth === item.month && styles.monthLabelSelected]}
                >
                  {formatMonthShort(item.month)}
                </Text>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  chartWithAxis: { flexDirection: "row" },
  axisColumn: {
    height: CHART_HEIGHT,
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginRight: 2,
  },
  axisLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: "600" },
  plotArea: { flex: 1 },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  monthCol: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 3,
    flex: 1,
    justifyContent: "flex-start",
    height: CHART_HEIGHT,
    borderRadius: 6,
  },
  monthColSelected: { backgroundColor: colors.statBg },
  bar: { width: 8, borderRadius: 4 },
  monthLabelsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  monthLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "600", flex: 1, textAlign: "left" },
  monthLabelSelected: { color: colors.textPrimary, fontWeight: "700" },
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.lg },
});
