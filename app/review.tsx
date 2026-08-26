import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { getCategoryStyle } from "../lib/categoryStyle";
import { formatAmount } from "../components/AmountText";
import { formatMerchantName } from "../lib/formatMerchant";
import { getCategories, getNeedsReview, setMerchantCategory, setTransactionIgnored } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Category, Transaction } from "../lib/types";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

export default function ReviewScreen() {
  const db = useSQLiteContext();
  const [items, setItems] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    getNeedsReview(db).then(setItems);
    getCategories(db).then(setCategories);
  }, [db]);

  useFocusEffect(load);

  async function assign(merchant: string, categoryId: number) {
    await setMerchantCategory(db, merchant, categoryId);
    setOpenId(null);
    load();
  }

  async function toggleIgnored(item: Transaction) {
    await setTransactionIgnored(db, item.id, !item.ignored);
    load();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={neutral.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Review</Text>
          <View style={styles.headerBtn} />
        </View>

        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.subtitle}>
              Assign a category once, and it'll apply to this merchant automatically from now on.
            </Text>
          }
          ListEmptyComponent={
            <EmptyState icon="✅" title="All caught up" subtitle="Nothing needs review right now." />
          }
          renderItem={({ item }) => {
            const open = openId === item.id;
            const style = getCategoryStyle(item.categoryName);
            const isNegative = item.amount < 0;
            return (
              <View style={[styles.card, item.ignored && styles.ignoredCard]}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.merchant}>{formatMerchantName(item.merchant)}</Text>
                    <Text style={styles.meta}>
                      {item.date} · {item.accountName}
                      {item.ignored ? " · ignored" : ""}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: isNegative ? "#DC2626" : "#16A34A" }]}>
                    {formatAmount(item.amount)}
                  </Text>
                </View>

                <Pressable onPress={() => setOpenId(open ? null : item.id)} style={styles.assignButton}>
                  <Text style={styles.assignButtonText}>
                    {open ? "Choose category..." : `Currently: ${style.emoji} ${item.categoryName} — tap to fix`}
                  </Text>
                </Pressable>

                {open && (
                  <View style={styles.categoryRow}>
                    {categories.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => assign(item.merchant, c.id)}
                        style={styles.categoryChip}
                      >
                        <Text style={styles.categoryChipText}>
                          {getCategoryStyle(c.name).emoji} {c.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                <Pressable onPress={() => toggleIgnored(item)} style={styles.ignoreRow}>
                  <Ionicons
                    name={item.ignored ? "eye-outline" : "eye-off-outline"}
                    size={13}
                    color={ACCENT}
                  />
                  <Text style={styles.ignoreLinkText}>
                    {item.ignored ? "Include in totals" : "Ignore (don't count toward totals)"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: neutral.textPrimary },
  subtitle: { fontSize: 13, color: neutral.textSecondary, marginBottom: spacing.sm },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  ignoredCard: { opacity: 0.55 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  merchant: { fontSize: 14, fontWeight: "600", color: neutral.textPrimary, marginBottom: 2 },
  meta: { fontSize: 12, color: neutral.textSecondary },
  amount: { fontSize: 14, fontWeight: "700" },
  assignButton: {
    backgroundColor: ACCENT_LIGHT,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  assignButtonText: { color: ACCENT, fontWeight: "600", fontSize: 13 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: neutral.card,
    borderWidth: 1.5,
    borderColor: neutral.border,
  },
  categoryChipText: { color: neutral.textPrimary, fontWeight: "600", fontSize: 13 },
  ignoreRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ignoreLinkText: { fontSize: 12, color: ACCENT, fontWeight: "600" },
});
