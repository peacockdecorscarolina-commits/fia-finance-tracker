import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";
import type { MonthlyTotal } from "../lib/db";

function formatMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

// Rounds up to a "clean" axis ceiling (1, 2, or 5 times a power of ten) so
// the axis reads e.g. "0k / 1k / 2k" instead of an arbitrary raw max.
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 5, 10];
  const step = steps.find((s) => value <= s * magnitude) ?? 10;
  return step * magnitude;
}

function formatAxisLabel(value: number): string {
  if (value >= 1000) {
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
  const axisMax = niceMax(rawMax);

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
            <Text style={styles.axisLabel}>{formatAxisLabel(axisMax)}</Text>
            <Text style={styles.axisLabel}>{formatAxisLabel(axisMax / 2)}</Text>
            <Text style={styles.axisLabel}>{formatAxisLabel(0)}</Text>
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
    marginRight: spacing.sm,
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
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    flex: 1,
    justifyContent: "center",
    height: CHART_HEIGHT,
    borderRadius: 6,
  },
  monthColSelected: { backgroundColor: colors.statBg },
  bar: { width: 8, borderRadius: 4 },
  monthLabelsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  monthLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "600", flex: 1, textAlign: "center" },
  monthLabelSelected: { color: colors.textPrimary, fontWeight: "700" },
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.lg },
});
