import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import {
  getAccountSummary,
  getCategorySummary,
  getLatestTransactionMonth,
  getNeedsReviewCount,
  getPaymentTotal,
} from "../../lib/db";
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
}: {
  title: string;
  items: BreakdownItem[];
  emptyLabel: string;
  onItemPress?: (name: string) => void;
}) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <Card style={styles.breakdownCard}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        items.map((item) => (
          <Pressable
            key={item.name}
            style={styles.itemRow}
            onPress={onItemPress ? () => onItemPress(item.name) : undefined}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemValue}>${item.total.toFixed(2)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(item.total / max) * 100}%` }]} />
            </View>
          </Pressable>
        ))
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
    <Pressable style={styles.quickAction} onPress={onPress}>
      <View style={styles.quickActionIconWrap}>
        <Ionicons name={icon} size={22} color={colors.textPrimary} />
        {!!badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function SummaryScreen() {
  const db = useSQLiteContext();
  const [month, setMonth] = useState<string | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<BreakdownItem[]>([]);
  const [accountTotals, setAccountTotals] = useState<BreakdownItem[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [paymentTotal, setPaymentTotal] = useState(0);

  useFocusEffect(
    useCallback(() => {
      getNeedsReviewCount(db).then(setReviewCount);
      if (month === null) {
        getLatestTransactionMonth(db).then((latest) => setMonth(latest ?? currentMonth()));
        return;
      }
      getCategorySummary(db, month).then((rows) =>
        setCategoryTotals(rows.map((r) => ({ name: r.categoryName, total: r.total })))
      );
      getAccountSummary(db, month).then((rows) =>
        setAccountTotals(rows.map((r) => ({ name: r.accountName, total: r.total })))
      );
      getPaymentTotal(db, month).then(setPaymentTotal);
    }, [db, month])
  );

  if (month === null) return <Screen><View /></Screen>;

  const total = categoryTotals.reduce((sum, t) => sum + t.total, 0);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Summary</Text>

        <View style={styles.monthRow}>
          <Pressable onPress={() => setMonth(shiftMonth(month, -1))} style={styles.monthButton}>
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.monthLabel}>{formatMonthLabel(month)}</Text>
          <Pressable onPress={() => setMonth(shiftMonth(month, 1))} style={styles.monthButton}>
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.quickActionRow}>
          <QuickAction
            icon="checkmark-done-outline"
            label="Review"
            badge={reviewCount}
            onPress={() => router.push("/review")}
          />
          <QuickAction
            icon="card-outline"
            label="Accounts"
            onPress={() => router.push("/accounts")}
          />
          <QuickAction
            icon="pricetag-outline"
            label="Categories"
            onPress={() => router.push("/categories")}
          />
          <QuickAction
            icon="swap-horizontal-outline"
            label="Move"
            onPress={() => router.push("/move-transactions")}
          />
          {Platform.OS === "web" && (
            <QuickAction
              icon="cloud-outline"
              label="Sync"
              onPress={() => router.push("/sync")}
            />
          )}
        </View>

        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total spent</Text>
          <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
        </Card>

        {paymentTotal !== 0 && (
          <Pressable
            onPress={() => router.push({ pathname: "/category/[name]", params: { name: "Payment", month } })}
          >
            <Card style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total paid</Text>
              <Text style={styles.totalValue}>${paymentTotal.toFixed(2)}</Text>
            </Card>
          </Pressable>
        )}

        <Breakdown
          title="By card"
          items={accountTotals}
          emptyLabel="No spending recorded on any card this month."
        />

        <Breakdown
          title="By category"
          items={categoryTotals}
          emptyLabel="No spending recorded for this month."
          onItemPress={(name) => router.push({ pathname: "/category/[name]", params: { name, month } })}
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
  quickActionRow: { flexDirection: "row", gap: spacing.md, justifyContent: "center" },
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
  itemRow: { gap: 6 },
  itemHeader: { flexDirection: "row", justifyContent: "space-between" },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  itemValue: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.pillActive,
  },
  empty: { textAlign: "center", color: colors.textSecondary },
});
