import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { LineChart } from "../../components/LineChart";
import { getCategoryStyle } from "../../lib/categoryStyle";
import { getMerchantTransactions, todayISO } from "../../lib/db";
import { formatMerchantName } from "../../lib/formatMerchant";
import { merchantHistory, type MerchantHistory } from "../../lib/merchantInsights";
import { radius, spacing } from "../../lib/theme";
import type { Transaction } from "../../lib/types";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const SHOWN_AT_FIRST = 20;

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(d: string, withYear = false): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// One merchant's history: how much, how often, which cards, and every
// transaction. Opened from a transaction, Summary's lists and the check-in.
export default function MerchantScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [history, setHistory] = useState<MerchantHistory | null>(null);
  const [showAll, setShowAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!name) return;
      getMerchantTransactions(db, name).then((list) => {
        setTransactions(list);
        setHistory(merchantHistory(list, todayISO()));
      });
    }, [db, name])
  );

  const title = formatMerchantName(name ?? "");
  const category = transactions[0]?.categoryName;
  // A payer (a paycheck, a tenant) rather than a store.
  const isIncomeSource = history !== null && history.visits === 0 && history.refunded > 0;
  const shown = showAll ? transactions : transactions.slice(0, SHOWN_AT_FIRST);
  const monthsWithSpend = history?.months.filter((m) => m.total > 0).length ?? 0;
  // The chart starts at the first month with spending, not a year of zeros.
  const firstSpend = history?.months.findIndex((m) => m.total > 0) ?? -1;
  const chartMonths = history && firstSpend >= 0 ? history.months.slice(firstSpend) : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {history && (
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={styles.heroLabel}>
              {isIncomeSource ? "Received from" : "Spent at"} {title}
              {history.firstDate ? ` since ${shortDate(history.firstDate, true)}` : ""}
            </Text>
            <Text style={styles.heroValue}>{formatMoney(isIncomeSource ? history.refunded : history.spent)}</Text>
            {!isIncomeSource && (
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{history.visits}</Text>
                  <Text style={styles.statLabel}>{history.visits === 1 ? "visit" : "visits"}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatMoney(history.average)}</Text>
                  <Text style={styles.statLabel}>on average</Text>
                </View>
                {history.lastDate && (
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{shortDate(history.lastDate)}</Text>
                    <Text style={styles.statLabel}>last time</Text>
                  </View>
                )}
              </View>
            )}
            {(history.pattern || history.refunded > 0) && !isIncomeSource && (
              <Text style={styles.heroSub}>
                {[history.pattern, history.refunded > 0 ? `${formatMoney(history.refunded)} refunded` : null].filter(Boolean).join(" · ")}
              </Text>
            )}
          </LinearGradient>
        )}

        {history && !isIncomeSource && monthsWithSpend >= 2 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{chartMonths.length >= 12 ? "Last 12 months" : "By month"}</Text>
            <LineChart
              points={chartMonths.map((m) => m.total)}
              labels={chartMonths.map((m) =>
                new Date(`${m.month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })
              )}
              color={colors.accent}
              width={320}
            />
          </View>
        )}

        {history && history.byAccount.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Paid with</Text>
            {history.byAccount.map((a) => (
              <View key={a.accountName} style={styles.row}>
                <Text style={styles.rowName}>{a.accountName}</Text>
                <Text style={styles.rowAmount}>{formatMoney(a.total)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>
              {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
            </Text>
            {category && (
              <Text style={styles.category}>
                {getCategoryStyle(category).emoji} {category}
              </Text>
            )}
          </View>
          {shown.map((t) => (
            <View key={t.id} style={[styles.row, t.ignored && { opacity: 0.5 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{shortDate(t.date, true)}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[t.accountName, t.ignored ? "ignored" : null, t.note].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Text style={[styles.rowAmount, t.amount > 0 && { color: "#16A34A" }]}>
                {t.amount > 0 ? "+" : ""}
                {formatMoney(Math.abs(t.amount))}
              </Text>
            </View>
          ))}
          {transactions.length > SHOWN_AT_FIRST && (
            <Pressable onPress={() => setShowAll((v) => !v)}>
              <Text style={styles.link}>{showAll ? "Show fewer" : `Show all ${transactions.length}`}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
    heroValue: { fontSize: 28, fontWeight: "800", color: "#FFFFFF" },
    heroSub: { fontSize: 12, color: "#FFFFFFCC" },
    statRow: { flexDirection: "row", gap: spacing.sm },
    stat: { flex: 1, backgroundColor: "#FFFFFF1F", borderRadius: radius.chip, padding: spacing.sm },
    statValue: { fontSize: 15, fontWeight: "800", color: "#FFFFFF" },
    statLabel: { fontSize: 11, color: "#FFFFFFCC", marginTop: 1 },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    category: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 4 },
    rowName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    rowAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    link: { fontSize: 13, fontWeight: "700", color: colors.accent, textAlign: "center", paddingTop: 4 },
  });
}
