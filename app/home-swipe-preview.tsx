import { useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { LineChart } from "../components/LineChart";
import { Screen } from "../components/Screen";
import { colors, radius, spacing } from "../lib/theme";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PANEL_WIDTH = Math.min(Dimensions.get("window").width - spacing.md * 2, 360);

const INVESTING_HISTORY = [16000, 17200, 18400, 21800, 23880];
const INVESTING_LABELS = ["Apr", "May", "Jun", "Jul", "Aug"];
const CASH_HISTORY = [180, 250, 210, 300, 320];
const CASH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug"];

function StatsPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>This Month</Text>
      <View style={styles.statRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Expenses</Text>
          <Text style={styles.statValue}>$448.92</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Income</Text>
          <Text style={styles.statValue}>$0.00</Text>
        </View>
      </View>
    </View>
  );
}

function InvestingPanel() {
  const first = INVESTING_HISTORY[0];
  const last = INVESTING_HISTORY[INVESTING_HISTORY.length - 1];
  const delta = last - first;
  const pct = (delta / first) * 100;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>📈 Investing</Text>
      <Text style={styles.panelValue}>{formatMoney(last)}</Text>
      <Text style={[styles.panelDelta, { color: delta >= 0 ? colors.positive : colors.negative }]}>
        {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%) over 5 months
      </Text>
      <LineChart points={INVESTING_HISTORY} labels={INVESTING_LABELS} color={colors.positive} width={PANEL_WIDTH - spacing.md * 2} />
    </View>
  );
}

function CashPanel() {
  const first = CASH_HISTORY[0];
  const last = CASH_HISTORY[CASH_HISTORY.length - 1];
  const delta = last - first;
  const pct = (delta / first) * 100;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>💵 Cash</Text>
      <Text style={styles.panelValue}>{formatMoney(last)}</Text>
      <Text style={[styles.panelDelta, { color: delta >= 0 ? colors.positive : colors.negative }]}>
        {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%) over 5 months
      </Text>
      <LineChart points={CASH_HISTORY} labels={CASH_LABELS} color={colors.accent} width={PANEL_WIDTH - spacing.md * 2} />
    </View>
  );
}

function LoanPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>🚗 Car Payment</Text>
      <Text style={[styles.panelValue, { color: colors.negative }]}>$20,650.12</Text>
      <Text style={styles.panelDelta}>2% paid off</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: "2%" }]} />
      </View>
    </View>
  );
}

const PANELS = [
  { key: "stats", render: StatsPanel },
  { key: "investing", render: InvestingPanel },
  { key: "cash", render: CashPanel },
  { key: "loan", render: LoanPanel },
];

export default function HomeSwipePreview() {
  const [page, setPage] = useState(0);

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.title}>Swipeable Home panel — demo</Text>
        <Text style={styles.subtitle}>Swipe left/right. Dots below show position.</Text>

        <Card style={styles.cardWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / PANEL_WIDTH);
              setPage(idx);
            }}
          >
            {PANELS.map((p) => (
              <View key={p.key} style={{ width: PANEL_WIDTH }}>
                <p.render />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dotsRow}>
            {PANELS.map((p, i) => (
              <View key={p.key} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary },
  cardWrap: { padding: 0, overflow: "hidden" },
  panel: { padding: spacing.md, gap: spacing.xs },
  panelTitle: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  panelValue: { fontSize: 24, fontWeight: "700", color: colors.textPrimary },
  panelDelta: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.xs },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  statBox: { flex: 1, backgroundColor: colors.statBg, borderRadius: radius.card, padding: spacing.md },
  statLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600", marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.statBg, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.negative },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 16 },
});
