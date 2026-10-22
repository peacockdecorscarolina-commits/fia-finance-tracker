import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatAmount } from "../components/AmountText";
import { formatMerchantName } from "../lib/formatMerchant";
import { dismissTransferMatch, findTransferMatches, linkTransactions, type TransferMatch } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

export default function FindTransfersScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [matches, setMatches] = useState<TransferMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkedCount, setLinkedCount] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    findTransferMatches(db).then((list) => {
      setMatches(list);
      setLoading(false);
    });
  }, [db]);

  useFocusEffect(load);

  async function handleLink(match: TransferMatch) {
    await linkTransactions(db, match.a.id, match.b.id);
    setLinkedCount((n) => n + 1);
    load();
  }

  async function handleDismiss(match: TransferMatch) {
    await dismissTransferMatch(db, match.a.id, match.b.id);
    load();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Find Transfers</Text>
          <View style={styles.headerBtn} />
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="swap-horizontal" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.heroText}>
            Scans every account for transactions that look like the same money moving between them — same amount,
            opposite direction, within about a week. Link the ones that are really the same transfer so they're not
            counted twice.
          </Text>
        </LinearGradient>

        {linkedCount > 0 && (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
            <Text style={styles.doneBannerText}>
              Linked {linkedCount} transfer{linkedCount === 1 ? "" : "s"}.
            </Text>
          </View>
        )}

        {!loading && matches.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No likely transfer pairs found right now. Upload both sides of a transfer (e.g. your checking and
              credit card statements) and check back here.
            </Text>
          </View>
        )}

        {matches.map((match) => (
          <View key={`${match.a.id}-${match.b.id}`} style={styles.matchCard}>
            <View style={styles.matchSide}>
              <Text style={styles.matchMerchant} numberOfLines={1}>
                {formatMerchantName(match.a.merchant)}
              </Text>
              <Text style={styles.matchMeta}>
                {match.a.accountName} · {match.a.date}
              </Text>
              <Text style={[styles.matchAmount, { color: match.a.amount < 0 ? "#DC2626" : "#16A34A" }]}>
                {formatAmount(match.a.amount)}
              </Text>
            </View>

            <Ionicons name="swap-horizontal" size={18} color={colors.textSecondary} style={styles.matchIcon} />

            <View style={styles.matchSide}>
              <Text style={styles.matchMerchant} numberOfLines={1}>
                {formatMerchantName(match.b.merchant)}
              </Text>
              <Text style={styles.matchMeta}>
                {match.b.accountName} · {match.b.date}
              </Text>
              <Text style={[styles.matchAmount, { color: match.b.amount < 0 ? "#DC2626" : "#16A34A" }]}>
                {formatAmount(match.b.amount)}
              </Text>
            </View>

            <View style={styles.matchActions}>
              <Pressable onPress={() => handleDismiss(match)} style={styles.dismissBtn}>
                <Text style={styles.dismissText}>Not a match</Text>
              </Pressable>
              <Pressable onPress={() => handleLink(match)} style={styles.linkBtn}>
                <Text style={styles.linkBtnText}>Link</Text>
              </Pressable>
            </View>
          </View>
        ))}
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
    headerTitle: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
    hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    heroIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    heroText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, opacity: 0.92 },
    doneBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "#DCFCE7",
      borderRadius: radius.chip,
      padding: spacing.sm,
    },
    doneBannerText: { fontSize: 12, color: "#16A34A", fontWeight: "600" },
    emptyCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md },
    emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center", lineHeight: 18 },
    matchCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      gap: spacing.sm,
    },
    matchSide: { gap: 2 },
    matchMerchant: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    matchMeta: { fontSize: 12, color: colors.textSecondary },
    matchAmount: { fontSize: 13, fontWeight: "700" },
    matchIcon: { alignSelf: "center" },
    matchActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    dismissBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
    },
    dismissText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
    linkBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: "#4C1D95" },
    linkBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  });
}
