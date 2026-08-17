import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { AmountText } from "../components/AmountText";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { getCategories, getNeedsReview, setMerchantCategory } from "../lib/db";
import { colors, radius, spacing } from "../lib/theme";
import type { Category, Transaction } from "../lib/types";

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

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.subtitle}>
          Assign a category once, and it'll apply to this merchant automatically from now on.
        </Text>

        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>Nothing needs review right now.</Text>
          }
          renderItem={({ item }) => {
            const open = openId === item.id;
            return (
              <Card style={styles.card}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.merchant}>{item.merchant}</Text>
                    <Text style={styles.meta}>
                      {item.date} · {item.accountName}
                    </Text>
                  </View>
                  <AmountText amount={item.amount} size="sm" />
                </View>
                <Pressable
                  onPress={() => setOpenId(open ? null : item.id)}
                  style={styles.assignButton}
                >
                  <Text style={styles.assignButtonText}>
                    {open ? "Choose category..." : `Currently: ${item.categoryName} — tap to fix`}
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
                        <Text style={styles.categoryChipText}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </Card>
            );
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  card: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  merchant: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, marginBottom: 2 },
  meta: { fontSize: 12, color: colors.textSecondary },
  assignButton: {
    backgroundColor: colors.accentBg,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  assignButtonText: { color: colors.accent, fontWeight: "600", fontSize: 13 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
});
