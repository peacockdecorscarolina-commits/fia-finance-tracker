import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { getRecurring, setRecurringOverride } from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { describeSchedule, type Recurring } from "../lib/subscriptions";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const ACCENT = "#4C1D95";
const DANGER = "#DC2626";

const PER: Record<Recurring["frequency"], string> = { weekly: "week", monthly: "month", yearly: "year" };

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SubscriptionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [items, setItems] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    getRecurring(db).then((list) => {
      setItems(list);
      setLoading(false);
    });
  }, [db]);

  useFocusEffect(load);

  async function markNot(item: Recurring) {
    await setRecurringOverride(db, item.merchant, "not");
    setExpanded(null);
    load();
  }

  async function clearMark(item: Recurring) {
    await setRecurringOverride(db, item.merchant, null);
    setExpanded(null);
    load();
  }

  const active = items.filter((i) => !i.isStopped);
  const subscriptions = active.filter((i) => i.kind === "subscription");
  const bills = active.filter((i) => i.kind === "bill");
  const stopped = items.filter((i) => i.isStopped);
  const monthly = active.reduce((sum, i) => sum + i.monthlyCost, 0);

  function Row({ item }: { item: Recurring }) {
    const open = expanded === item.merchantKey;
    return (
      <View style={styles.row}>
        <Pressable onPress={() => setExpanded(open ? null : item.merchantKey)} style={styles.rowTop}>
          <View style={[styles.rowIcon, item.kind === "bill" && styles.rowIconBill]}>
            <Ionicons name={item.kind === "bill" ? "receipt-outline" : "repeat"} size={16} color={ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {formatMerchantName(item.merchant)}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.accountName} · {describeSchedule(item)}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              Last {formatDate(item.lastDate)}
              {item.isStopped ? "" : ` · next ${formatDate(item.nextDate)}`}
            </Text>
            <View style={styles.badgeRow}>
              {item.previousAmount !== null && item.amount > item.previousAmount && (
                <Text style={[styles.badge, styles.badgeWarn]}>▲ up from {formatMoney(item.previousAmount)}</Text>
              )}
              {item.previousAmount !== null && item.amount < item.previousAmount && (
                <Text style={styles.badge}>▼ down from {formatMoney(item.previousAmount)}</Text>
              )}
              {item.isNew && <Text style={[styles.badge, styles.badgeNew]}>New</Text>}
              {item.isStopped && <Text style={styles.badge}>No charge since {formatDate(item.lastDate)} — cancelled?</Text>}
              {item.markedByUser && <Text style={styles.badge}>Marked by you</Text>}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.rowAmount}>{formatMoney(item.amount)}</Text>
            <Text style={styles.rowPer}>/ {PER[item.frequency]}</Text>
            <Text style={styles.rowYearly}>{formatMoney(item.yearlyCost)}/yr</Text>
          </View>
        </Pressable>

        {open && (
          <View style={styles.detail}>
            <Text style={styles.detailTitle}>Charges</Text>
            {item.charges.map((c) => (
              <View key={c.id} style={styles.chargeRow}>
                <Text style={styles.chargeDate}>{c.date}</Text>
                <Text style={styles.chargeAccount} numberOfLines={1}>
                  {c.accountName}
                </Text>
                <Text style={styles.chargeAmount}>{formatMoney(Math.abs(c.amount))}</Text>
              </View>
            ))}
            <View style={styles.detailActions}>
              {item.markedByUser ? (
                <Pressable onPress={() => clearMark(item)} style={styles.detailBtn}>
                  <Text style={styles.detailBtnText}>Let the app decide</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => markNot(item)} style={[styles.detailBtn, styles.detailBtnDanger]}>
                <Ionicons name="close-circle-outline" size={14} color={DANGER} />
                <Text style={[styles.detailBtnText, { color: DANGER }]}>Not a subscription</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  }

  function Section({ title, list }: { title: string; list: Recurring[] }) {
    if (list.length === 0) return null;
    const total = list.reduce((sum, i) => sum + i.monthlyCost, 0);
    return (
      <View style={{ gap: spacing.sm }}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {title !== "Possibly cancelled" && <Text style={styles.sectionTotal}>{formatMoney(total)}/mo</Text>}
        </View>
        <View style={styles.card}>
          {list.map((item, i) => (
            <View key={item.merchantKey} style={i > 0 && styles.divider}>
              <Row item={item} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Subscriptions</Text>
          <View style={styles.headerBtn} />
        </View>

        {!loading && active.length > 0 && (
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={styles.heroLabel}>
              {subscriptions.length} subscription{subscriptions.length === 1 ? "" : "s"} · {bills.length} bill
              {bills.length === 1 ? "" : "s"}
            </Text>
            <Text style={styles.heroValue}>{formatMoney(monthly)} / month</Text>
            <Text style={styles.heroSub}>{formatMoney(monthly * 12)} a year</Text>
          </LinearGradient>
        )}

        {!loading && items.length === 0 && (
          <View style={styles.card}>
            <EmptyState
              icon="🔁"
              title="No subscriptions found yet"
              subtitle="Charges that repeat show up here after the second one. Upload a few months of statements, or tap Subscription on any transaction to mark it yourself."
            />
          </View>
        )}

        <Section title="Subscriptions" list={subscriptions} />
        <Section title="Bills" list={bills} />
        <Section title="Possibly cancelled" list={stopped} />

        {!loading && items.length > 0 && (
          <Text style={styles.footnote}>
            Found by looking for the same merchant charging about the same amount every week, month or year. Missing
            one? Tap Subscription on any of its transactions.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    hero: { borderRadius: radius.card, padding: spacing.md, gap: 2 },
    heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
    heroValue: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
    heroSub: { fontSize: 13, color: "#FFFFFFCC" },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionTotal: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
    card: { backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: spacing.md },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    row: { paddingVertical: spacing.md, gap: spacing.sm },
    rowTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#EDE9FE",
      alignItems: "center",
      justifyContent: "center",
    },
    rowIconBill: { backgroundColor: "#DBEAFE" },
    rowName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
    rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    badge: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
      backgroundColor: colors.background,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      overflow: "hidden",
    },
    badgeWarn: { color: "#B45309", backgroundColor: "#FEF3C7" },
    badgeNew: { color: "#16A34A", backgroundColor: "#DCFCE7" },
    rowAmount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    rowPer: { fontSize: 11, color: colors.textSecondary },
    rowYearly: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
    detail: { backgroundColor: colors.background, borderRadius: radius.chip, padding: spacing.sm, gap: 6 },
    detailTitle: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
    chargeRow: { flexDirection: "row", gap: spacing.sm },
    chargeDate: { fontSize: 13, color: colors.textPrimary, width: 92 },
    chargeAccount: { flex: 1, fontSize: 13, color: colors.textSecondary },
    chargeAmount: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
    detailActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
    detailBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.card,
    },
    detailBtnDanger: { backgroundColor: "#FEE2E2" },
    detailBtnText: { fontSize: 12, fontWeight: "700", color: ACCENT },
    footnote: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, textAlign: "center" },
  });
}
