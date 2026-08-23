import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { PressScale } from "../../components/PressScale";
import { Screen } from "../../components/Screen";
import { Shimmer } from "../../components/Shimmer";
import {
  getAccountSummary,
  getCategorySummary,
  getLatestTransactionMonth,
  getNeedsReviewCount,
  getPaymentTotal,
} from "../../lib/db";
import { getAccountStyle } from "../../lib/accountStyle";
import { getCategoryStyle } from "../../lib/categoryStyle";
import { colors, radius, spacing, tabBarClearance } from "../../lib/theme";

type BreakdownItem = { name: string; total: number };

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Breakdown({
  title,
  items,
  emptyLabel,
  onItemPress,
  getItemStyle,
  loading,
}: {
  title: string;
  items: BreakdownItem[];
  emptyLabel: string;
  onItemPress?: (name: string) => void;
  getItemStyle?: (name: string) => { emoji: string | null; color: string };
  loading?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <Card style={styles.breakdownCard}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      {loading ? (
        <View style={{ gap: spacing.sm }}>
          <Shimmer width="70%" height={14} />
          <Shimmer width="100%" height={8} />
          <Shimmer width="55%" height={14} />
          <Shimmer width="100%" height={8} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState icon="📊" title="Nothing here yet" subtitle={emptyLabel} />
      ) : (
        items.map((item) => {
          const { emoji, color } = getItemStyle ? getItemStyle(item.name) : { emoji: null, color: colors.accent };
          return (
            <Pressable
              key={item.name}
              style={styles.itemRow}
              onPress={onItemPress ? () => onItemPress(item.name) : undefined}
            >
              <View style={[styles.itemLeftBar, { backgroundColor: color }]} />
              <View style={{ flex: 1 }}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemName}>
                    {emoji ? `${emoji} ` : ""}
                    {item.name}
                  </Text>
                  <AnimatedAmount value={item.total} style={styles.itemValue} />
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[styles.barFill, { width: `${(item.total / max) * 100}%`, backgroundColor: color }]}
                  />
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

function QuickAction({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <PressScale onPress={onPress} style={styles.quickAction}>
      <View style={styles.quickActionIconWrap}>
        <Ionicons name={icon} size={22} color={colors.textPrimary} />
        {!!badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </PressScale>
  );
}

type MoreItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };

function MoreSheet({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: MoreItem[] }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>More tools</Text>
          {items.map((item) => (
            <PressScale
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={{ alignSelf: "stretch" }}
            >
              <View style={styles.sheetRow}>
                <View style={styles.sheetIconWrap}>
                  <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
                </View>
                <Text style={styles.sheetRowLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </View>
            </PressScale>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function SummaryScreen() {
  const db = useSQLiteContext();
  const [month, setMonth] = useState<string | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<BreakdownItem[]>([]);
  const [accountTotals, setAccountTotals] = useState<BreakdownItem[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getNeedsReviewCount(db).then(setReviewCount);
      if (month === null) {
        getLatestTransactionMonth(db).then((latest) => setMonth(latest ?? currentMonth()));
        return;
      }
      setLoading(true);
      Promise.all([
        getCategorySummary(db, month).then((rows) =>
          setCategoryTotals(rows.map((r) => ({ name: r.categoryName, total: r.total })))
        ),
        getAccountSummary(db, month).then((rows) =>
          setAccountTotals(rows.map((r) => ({ name: r.accountName, total: r.total })))
        ),
        getPaymentTotal(db, month).then(setPaymentTotal),
      ]).then(() => setLoading(false));
    }, [db, month])
  );

  if (month === null) return <Screen><View /></Screen>;

  const total = categoryTotals.reduce((sum, t) => sum + t.total, 0);

  const moreItems: MoreItem[] = [
    { icon: "card-outline", label: "Accounts", onPress: () => router.push("/accounts") },
    { icon: "pricetag-outline", label: "Categories", onPress: () => router.push("/categories") },
    { icon: "swap-horizontal-outline", label: "Move", onPress: () => router.push("/move-transactions") },
    { icon: "trash-outline", label: "Delete", onPress: () => router.push("/delete-transactions") },
    ...(Platform.OS === "web"
      ? [{ icon: "cloud-outline" as const, label: "Sync", onPress: () => router.push("/sync") }]
      : []),
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Summary</Text>

        <View style={styles.monthRow}>
          <PressScale onPress={() => setMonth(shiftMonth(month, -1))} style={styles.monthButton}>
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </PressScale>
          <Text style={styles.monthLabel}>{formatMonthLabel(month)}</Text>
          <PressScale onPress={() => setMonth(shiftMonth(month, 1))} style={styles.monthButton}>
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </PressScale>
        </View>

        <View style={styles.quickActionRow}>
          <QuickAction icon="add-circle-outline" label="Add" onPress={() => router.push("/add-transaction")} />
          <QuickAction
            icon="checkmark-done-outline"
            label="Review"
            badge={reviewCount}
            onPress={() => router.push("/review")}
          />
          <QuickAction icon="ellipsis-horizontal" label="More" onPress={() => setMoreOpen(true)} />
        </View>
        <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />

        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total spent</Text>
          {loading ? <Shimmer width={140} height={32} /> : <AnimatedAmount value={total} style={styles.totalValue} />}
        </Card>

        {!loading && paymentTotal !== 0 && (
          <Pressable
            onPress={() => router.push({ pathname: "/category/[name]", params: { name: "Payment", month } })}
          >
            <Card style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total paid</Text>
              <AnimatedAmount value={paymentTotal} style={styles.totalValue} />
            </Card>
          </Pressable>
        )}

        <Breakdown
          title="By card"
          items={accountTotals}
          emptyLabel="No spending recorded on any card this month."
          getItemStyle={getAccountStyle}
          loading={loading}
        />

        <Breakdown
          title="By category"
          items={categoryTotals}
          emptyLabel="No spending recorded for this month."
          onItemPress={(name) => router.push({ pathname: "/category/[name]", params: { name, month } })}
          getItemStyle={getCategoryStyle}
          loading={loading}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.md, paddingBottom: tabBarClearance },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  monthButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  monthLabel: { fontSize: 16, fontWeight: "600", color: colors.textPrimary, minWidth: 160, textAlign: "center" },
  quickActionRow: { flexDirection: "row", gap: spacing.lg, justifyContent: "center" },
  quickAction: { alignItems: "center", gap: 6 },
  quickActionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.negative,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  quickActionLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  totalCard: { gap: 4 },
  totalLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  totalValue: { fontSize: 32, fontWeight: "700", color: colors.textPrimary },
  breakdownCard: { gap: spacing.md },
  breakdownTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  itemRow: { flexDirection: "row", gap: spacing.sm },
  itemLeftBar: { width: 4, borderRadius: 2, alignSelf: "stretch" },
  itemHeader: { flexDirection: "row", justifyContent: "space-between" },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  itemValue: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: 6,
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.pillActive,
  },
  empty: { textAlign: "center", color: colors.textSecondary },
  sheetBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.cardSolid,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentBg,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
});
