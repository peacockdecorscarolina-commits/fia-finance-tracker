import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { changeLine, sortCategoryRows, totalChangeLine, type CategoryDetails, type CategorySort, type ChangeTone } from "../lib/categoryDetails";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getCategoryDetails, getTransactionMonthBounds } from "../lib/db";
import { personFilterFromParams } from "../lib/people";
import { currentMonth, shiftMonth } from "../lib/period";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const GRADIENT = ["#4C1D95", "#312E81"] as const;
const SORTS = ["Highest spend", "Biggest change"] as const;
type SortLabel = (typeof SORTS)[number];
const SORT_OF: Record<SortLabel, CategorySort> = { "Highest spend": "amount", "Biggest change": "change" };

// These pills keep their colors in light and dark, like the app's other chips.
const TONE: Record<ChangeTone, { bg: string; fg: string }> = {
  up: { bg: "#FEF3C7", fg: "#92400E" },
  down: { bg: "#DBEAFE", fg: "#1E40AF" },
  same: { bg: "#E8E6EF", fg: "#3F3B52" },
};

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The period before or after: a month, or a bare year.
function stepPeriod(key: string, by: number): string {
  return /^\d{4}$/.test(key) ? String(Number(key) + by) : shiftMonth(key, by);
}

function periodTitle(key: string): string {
  if (/^\d{4}$/.test(key)) return key;
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Every category for a period: its share, how it moved, and where it went.
// Opened from "View all" on Summary, for the period and person picked there.
export default function CategoryDetailsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const { period: startPeriod, person, personName, peopleCount } = useLocalSearchParams<{
    period: string;
    person?: string;
    personName?: string;
    peopleCount?: string;
  }>();
  const [data, setData] = useState<{ details: CategoryDetails; label: string } | null>(null);
  const [sort, setSort] = useState<SortLabel>("Highest spend");
  // Starts on the period picked on Summary; the arrows move it from there.
  const [period, setPeriod] = useState(startPeriod);
  const [bounds, setBounds] = useState<{ first: string; last: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!period) return;
      // Tapping quickly: only the period still showing gets to land.
      let current = true;
      getCategoryDetails(db, period, personFilterFromParams(person, peopleCount)).then((next) => {
        if (current) setData(next);
      });
      getTransactionMonthBounds(db).then((b) => {
        if (current) setBounds(b);
      });
      return () => {
        current = false;
      };
    }, [db, period, person, peopleCount])
  );

  // From the first month with transactions up to this month (or later, if
  // a statement has future-dated ones). A year compares by its first 4 digits.
  const isYear = /^\d{4}$/.test(period ?? "");
  const cut = (month: string) => (isYear ? month.slice(0, 4) : month);
  const newest = bounds && bounds.last > currentMonth() ? bounds.last : currentMonth();
  const canGoBack = !!bounds && !!period && period > cut(bounds.first);
  const canGoForward = !!period && period < cut(newest);

  const personLinks = person && personName && peopleCount ? { person, personName, peopleCount } : {};
  const summary = data ? totalChangeLine(data.details, data.label) : null;
  const canCompare = !!data && data.details.previousTotal > 0;
  const rows = data ? sortCategoryRows(data.details.rows, canCompare ? SORT_OF[sort] : "amount") : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>All categories</Text>
          <View style={styles.headerBtn} />
        </View>

        {data && (
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroRow}>
              <PeriodArrow direction="back" enabled={canGoBack} isYear={isYear} onPress={() => setPeriod(stepPeriod(period, -1))} styles={styles} />
              <View style={styles.heroMiddle}>
                <Text style={styles.heroLabel} numberOfLines={1}>
                  {periodTitle(period)}
                  {personName ? ` · ${personName} spending` : ""}
                </Text>
                <Text style={styles.heroValue}>{money(data.details.total)}</Text>
                {summary ? (
                  <Text style={styles.heroSub} numberOfLines={1}>
                    {summary}
                  </Text>
                ) : null}
              </View>
              <PeriodArrow direction="forward" enabled={canGoForward} isYear={isYear} onPress={() => setPeriod(stepPeriod(period, 1))} styles={styles} />
            </View>
          </LinearGradient>
        )}

        {personName ? <Text style={styles.note}>Shared charges count as a share.</Text> : null}

        {canCompare && (
          <View style={styles.sortRow}>
            {SORTS.map((option) => {
              const on = option === sort;
              return (
                <Pressable key={option} onPress={() => setSort(option)} hitSlop={8} style={[styles.sortChip, on && styles.sortChipOn]}>
                  <Text style={[styles.sortText, on && styles.sortTextOn]}>{option}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.versus} numberOfLines={1}>
              vs {data.label}
            </Text>
          </View>
        )}

        {data && rows.length === 0 && (
          <EmptyState icon="📊" title="Nothing here yet" subtitle="No spending recorded for this period." />
        )}

        {data && rows.length > 0 && (
          <View style={styles.list}>
            {rows.map((row, i) => {
              const color = getCategoryStyle(row.name).color;
              const change = changeLine(row);
              return (
                <Pressable
                  key={row.name}
                  onPress={() => router.push({ pathname: "/category/[name]", params: { name: row.name, month: period, ...personLinks } })}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                  accessibilityLabel={`Open ${row.name}`}
                >
                  <View style={styles.topRow}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text style={styles.name} numberOfLines={1}>
                      {row.name}
                    </Text>
                    {change ? (
                      <View style={[styles.pill, { backgroundColor: TONE[change.tone].bg }]}>
                        <Text style={[styles.pillText, { color: TONE[change.tone].fg }]} numberOfLines={1}>
                          {change.text}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.percent}>{row.percent.toFixed(1)}%</Text>
                    <Text style={styles.amount}>{money(row.amount)}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${row.bar * 100}%`, backgroundColor: color }]} />
                  </View>
                  {row.charges > 0 ? (
                    <Text style={styles.detail} numberOfLines={1}>
                      {row.charges} {row.charges === 1 ? "charge" : "charges"}
                      {row.topStore ? ` · Most at ${row.topStore}` : ""}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PeriodArrow({
  direction,
  enabled,
  isYear,
  onPress,
  styles,
}: {
  direction: "back" | "forward";
  enabled: boolean;
  isYear: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const word = direction === "back" ? "Previous" : "Next";
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      hitSlop={8}
      style={[styles.arrow, !enabled && styles.arrowOff]}
      accessibilityRole="button"
      accessibilityLabel={`${word} ${isYear ? "year" : "month"}`}
      accessibilityState={{ disabled: !enabled }}
    >
      <Ionicons name={direction === "back" ? "chevron-back" : "chevron-forward"} size={20} color="#FFFFFF" />
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.sm },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    hero: { borderRadius: 16, paddingHorizontal: spacing.md - 2, paddingVertical: 10, gap: 1 },
    heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    heroMiddle: { flex: 1, alignItems: "center", gap: 1, minWidth: 0 },
    arrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFFFFF2E", alignItems: "center", justifyContent: "center" },
    arrowOff: { opacity: 0.3 },
    heroLabel: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
    heroValue: { fontSize: 22, fontWeight: "800", color: "#FFFFFF" },
    heroSub: { fontSize: 12, fontWeight: "600", color: "#E9E4F5" },
    note: { fontSize: 11, color: colors.textSecondary, textAlign: "center" },
    sortRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    sortChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.card },
    sortChipOn: { backgroundColor: "#4C1D95" },
    sortText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
    sortTextOn: { color: "#FFFFFF" },
    versus: { flex: 1, textAlign: "right", fontSize: 11, fontWeight: "600", color: colors.textSecondary },
    list: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 12 },
    row: { paddingVertical: 8, gap: 4 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    topRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    name: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    percent: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, minWidth: 40, textAlign: "right" },
    amount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, minWidth: 70, textAlign: "right" },
    track: { height: 3, borderRadius: 2, backgroundColor: colors.background, overflow: "hidden" },
    fill: { height: 3, borderRadius: 2 },
    pill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
    pillText: { fontSize: 11, fontWeight: "700" },
    detail: { fontSize: 11, color: colors.textSecondary },
  });
}
