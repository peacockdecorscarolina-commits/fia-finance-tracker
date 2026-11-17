import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { autoBackup } from "../lib/autoBackup";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getRefunds, matchRefundTo, unmatchRefund, type OpenRefund, type RefundPair } from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Transaction } from "../lib/types";

const ACCENT = "#4C1D95";
const SHOWN = 30;

function money(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Card refunds and the purchases they undo. A matched refund takes its
// purchase's category; anything here can be unmatched or matched by hand.
export default function RefundsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [data, setData] = useState<{ matched: RefundPair[]; open: OpenRefund[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    getRefunds(db).then(setData);
  }, [db]);
  useFocusEffect(load);

  async function unmatch(refund: Transaction) {
    await unmatchRefund(db, refund.id);
    autoBackup(db);
    load();
  }

  async function match(refund: Transaction, purchase: Transaction) {
    await matchRefundTo(db, refund.id, purchase.id);
    autoBackup(db);
    load();
  }

  const matched = data ? (showAll ? data.matched : data.matched.slice(0, SHOWN)) : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Refunds</Text>
          <View style={styles.headerBtn} />
        </View>

        <Text style={styles.intro}>
          Fia matches a card refund to the purchase it came from, and gives the refund that purchase’s category. Check the matches here.
        </Text>

        {data && data.open.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No purchase found ({data.open.length})</Text>
            {data.open.map(({ refund, suggestions }) => (
              <View key={refund.id} style={styles.block}>
                <RefundLine t={refund} styles={styles} />
                {suggestions.length === 0 ? (
                  <Text style={styles.hint}>No purchase on this card fits. It may be from before your first upload. Sort it on Review.</Text>
                ) : (
                  <>
                    <Text style={styles.hint}>Could be for:</Text>
                    {suggestions.map((p) => (
                      <View key={p.id} style={styles.suggestion}>
                        <Text style={styles.suggestionText} numberOfLines={1}>
                          {formatMerchantName(p.merchant)} · {money(p.amount)} · {shortDate(p.date)}
                        </Text>
                        <Pressable onPress={() => match(refund, p)} style={styles.matchBtn} accessibilityLabel={`Match with ${formatMerchantName(p.merchant)} on ${shortDate(p.date)}`}>
                          <Text style={styles.matchText}>Match</Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}
              </View>
            ))}
          </View>
        )}

        {data && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Matched ({data.matched.length})</Text>
            {data.matched.length === 0 && <Text style={styles.hint}>No refunds matched yet. They show up here after you upload card statements with refunds on them.</Text>}
            {matched.map(({ refund, purchase }) => (
              <View key={refund.id} style={styles.block}>
                <RefundLine t={refund} styles={styles} />
                <View style={styles.forRow}>
                  <Ionicons name="return-down-forward" size={14} color={colors.textSecondary} />
                  <Text style={styles.forText} numberOfLines={1}>
                    For {formatMerchantName(purchase.merchant)} · {money(purchase.amount)} · {shortDate(purchase.date)}
                  </Text>
                </View>
                <View style={styles.forRow}>
                  <Text style={styles.category}>
                    {getCategoryStyle(refund.categoryName).emoji} {refund.categoryName}
                  </Text>
                  <Pressable onPress={() => unmatch(refund)} hitSlop={8} accessibilityLabel={`${formatMerchantName(refund.merchant)} refund is not a match`}>
                    <Text style={styles.unmatch}>Not a match</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {!showAll && data.matched.length > SHOWN && (
              <Pressable onPress={() => setShowAll(true)}>
                <Text style={styles.link}>Show all {data.matched.length}</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RefundLine({ t, styles }: { t: Transaction; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.refundRow}>
      <Text style={styles.refundName} numberOfLines={1}>
        ↩ {formatMerchantName(t.merchant)}
      </Text>
      <Text style={styles.refundAmount}>+{money(t.amount)}</Text>
      <Text style={styles.refundMeta}>
        {shortDate(t.date)} · {t.accountName}
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    intro: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    block: { gap: 4, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    refundRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
    refundName: { flexShrink: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    refundAmount: { fontSize: 14, fontWeight: "700", color: "#16A34A" },
    refundMeta: { fontSize: 12, color: colors.textSecondary },
    forRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
    forText: { flex: 1, fontSize: 13, color: colors.textPrimary },
    category: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    unmatch: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
    hint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    suggestion: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    suggestionText: { flex: 1, fontSize: 13, color: colors.textPrimary },
    matchBtn: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    matchText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
    link: { fontSize: 13, fontWeight: "700", color: colors.accent, textAlign: "center" },
  });
}
