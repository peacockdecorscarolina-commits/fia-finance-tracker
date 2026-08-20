import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { colors, radius, spacing } from "../lib/theme";
import type { Category, Transaction } from "../lib/types";
import { AmountText } from "./AmountText";
import { Card } from "./Card";
import { CategoryChip } from "./CategoryChip";
import { Chip } from "./Chip";

export function TransactionRow({
  transaction,
  onToggleIgnored,
  categories,
  onChangeCategory,
}: {
  transaction: Transaction;
  onToggleIgnored?: (transaction: Transaction) => void;
  categories?: Category[];
  onChangeCategory?: (transaction: Transaction, categoryId: number) => void;
}) {
  const [pickingCategory, setPickingCategory] = useState(false);

  return (
    <Card style={transaction.ignored ? { ...styles.card, ...styles.ignoredCard } : styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant}>{transaction.merchant}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {transaction.date} · {transaction.accountName}
            </Text>
            <CategoryChip name={transaction.categoryName} />
            {transaction.needsReview && <Chip label="review" tone="warning" />}
            {transaction.ignored && <Chip label="ignored" />}
          </View>
        </View>
        <AmountText amount={transaction.amount} />
      </View>

      <View style={styles.actionsRow}>
        {categories && onChangeCategory && (
          <Pressable onPress={() => setPickingCategory((v) => !v)}>
            <Text style={styles.actionLinkText}>
              {pickingCategory ? "Cancel" : "Change category"}
            </Text>
          </Pressable>
        )}
        {onToggleIgnored && (
          <Pressable onPress={() => onToggleIgnored(transaction)}>
            <Text style={styles.actionLinkText}>
              {transaction.ignored ? "Include in totals" : "Ignore (don't count toward totals)"}
            </Text>
          </Pressable>
        )}
      </View>

      {pickingCategory && categories && onChangeCategory && (
        <View style={styles.categoryRow}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              style={styles.categoryChip}
              onPress={() => {
                onChangeCategory(transaction, c.id);
                setPickingCategory(false);
              }}
            >
              <Text style={styles.categoryChipText}>
                {getCategoryStyle(c.name).emoji} {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  ignoredCard: { opacity: 0.55 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  merchant: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { fontSize: 12, color: colors.textSecondary, marginRight: 4 },
  actionsRow: { flexDirection: "row", gap: spacing.md },
  actionLinkText: { fontSize: 12, color: colors.accent, fontWeight: "600" },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
});
