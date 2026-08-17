import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";
import type { MonthlyTotal } from "../lib/db";

function formatMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

const CHART_HEIGHT = 120;

export function MonthlyBarChart({ data }: { data: MonthlyTotal[] }) {
  const max = Math.max(...data.flatMap((d) => [d.income, d.expenses]), 1);

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
        <View style={styles.chartRow}>
          {data.map((item) => (
            <View key={item.month} style={styles.monthCol}>
              <View style={styles.barsRow}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max((item.income / max) * CHART_HEIGHT, 2), backgroundColor: colors.positive },
                  ]}
                />
                <View
                  style={[
                    styles.bar,
                    { height: Math.max((item.expenses / max) * CHART_HEIGHT, 2), backgroundColor: colors.negative },
                  ]}
                />
              </View>
              <Text style={styles.monthLabel}>{formatMonthShort(item.month)}</Text>
            </View>
          ))}
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
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT + 24,
  },
  monthCol: { alignItems: "center", gap: 6, flex: 1 },
  barsRow: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: CHART_HEIGHT },
  bar: { width: 8, borderRadius: 4 },
  monthLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.lg },
});
