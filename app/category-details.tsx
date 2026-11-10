import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { SegmentedControl } from "../components/SegmentedControl";
import { changeLine, sortCategoryRows, totalChangeLine, type CategoryDetails, type CategorySort, type ChangeTone } from "../lib/categoryDetails";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getCategoryDetails } from "../lib/db";
import { personFilterFromParams } from "../lib/people";
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
  const { period, person, personName, peopleCount } = useLocalSearchParams<{
    period: string;
    person?: string;
    personName?: string;
    peopleCount?: string;
  }>();
  const [data, setData] = useState<{ details: CategoryDetails; label: string } | null>(null);
  const [sort, setSort] = useState<SortLabel>("Highest spend");

  useFocusEffect(
    useCallback(() => {
      if (!period) return;
      getCategoryDetails(db, period, personFilterFromParams(person, peopleCount)).then(setData);
    }, [db, period, person, peopleCount])
  );

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
            <Text style={styles.heroLabel}>
              {periodTitle(period)}
              {personName ? ` · ${personName} spending` : ""}
            </Text>
            <Text style={styles.heroValue}>{money(data.details.total)}</Text>
            {summary ? <Text style={styles.heroSub}>{summary}</Text> : null}
          </LinearGradient>
        )}

        {personName ? <Text style={styles.note}>Shared charges count as a share.</Text> : null}

        {canCompare && <SegmentedControl options={SORTS} value={sort} onChange={setSort} />}

        {data && rows.length === 0 && (
          <EmptyState icon="📊" title="Nothing here yet" subtitle="No spending recorded for this period." />
        )}

        {data &&
          rows.map((row) => {
            const color = getCategoryStyle(row.name).color;
            const change = changeLine(row, data.label);
            return (
              <Pressable
                key={row.name}
                onPress={() => router.push({ pathname: "/category/[name]", params: { name: row.name, month: period, ...personLinks } })}
                style={styles.card}
                accessibilityLabel={`Open ${row.name}`}
              >
                <View style={styles.topRow}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.name} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={styles.percent}>{row.percent.toFixed(1)}%</Text>
                  <Text style={styles.amount}>{money(row.amount)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${row.bar * 100}%`, backgroundColor: color }]} />
                </View>
                <View style={styles.bottomRow}>
                  {change ? (
                    <View style={[styles.pill, { backgroundColor: TONE[change.tone].bg }]}>
                      <Text style={[styles.pillText, { color: TONE[change.tone].fg }]} numberOfLines={1}>
                        {change.text}
                      </Text>
                    </View>
                  ) : null}
                  {row.charges > 0 ? (
                    <Text style={styles.detail} numberOfLines={1}>
                      {row.charges} {row.charges === 1 ? "charge" : "charges"}
                      {row.topStore ? ` · Most at ${row.topStore}` : ""}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.sm + 4 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    hero: { borderRadius: radius.card, padding: spacing.md, gap: 4 },
    heroLabel: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
    heroValue: { fontSize: 30, fontWeight: "800", color: "#FFFFFF" },
    heroSub: { fontSize: 13, fontWeight: "600", color: "#E9E4F5" },
    note: { fontSize: 12, color: colors.textSecondary, textAlign: "center" },
    card: { backgroundColor: colors.card, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
    topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    name: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    percent: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    amount: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, minWidth: 78, textAlign: "right" },
    track: { height: 7, borderRadius: 4, backgroundColor: colors.background, overflow: "hidden" },
    fill: { height: 7, borderRadius: 4 },
    bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, minHeight: 22 },
    pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, flexShrink: 0 },
    pillText: { fontSize: 12, fontWeight: "700" },
    detail: { flex: 1, fontSize: 12, color: colors.textSecondary, textAlign: "right" },
  });
}
