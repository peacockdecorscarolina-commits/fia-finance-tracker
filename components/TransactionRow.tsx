import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing } from "../lib/theme";
import type { Category, Transaction } from "../lib/types";
import { AmountText } from "./AmountText";
import { Chip } from "./Chip";

// Matches the rest of the app's redesigned screens.
const neutral = {
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TransactionRow({
  transaction,
  onToggleIgnored,
  categories,
  onChangeCategory,
  onDelete,
}: {
  transaction: Transaction;
  onToggleIgnored?: (transaction: Transaction) => void;
  categories?: Category[];
  onChangeCategory?: (transaction: Transaction, categoryId: number) => void;
  onDelete?: (transaction: Transaction) => void;
}) {
  const [pickingCategory, setPickingCategory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const categoryStyle = getCategoryStyle(transaction.categoryName);

  return (
    <View style={[styles.card, transaction.ignored && styles.ignoredCard]}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: hexToRgba(categoryStyle.color, 0.14) }]}>
          <Text style={styles.avatarEmoji}>{categoryStyle.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant} numberOfLines={2}>
            {formatMerchantName(transaction.merchant)}
          </Text>
          <Text style={styles.meta}>
            {transaction.date} · {transaction.accountName}
          </Text>
          <View style={styles.chipRow}>
            <View style={[styles.categoryChip, { backgroundColor: hexToRgba(categoryStyle.color, 0.12) }]}>
              <Text style={styles.categoryChipEmoji}>{categoryStyle.emoji}</Text>
              <Text style={[styles.categoryChipLabel, { color: categoryStyle.color }]}>
                {transaction.categoryName}
              </Text>
            </View>
            {transaction.needsReview && <Chip label="review" tone="warning" />}
            {transaction.ignored && <Chip label="ignored" />}
          </View>
        </View>
        <AmountText amount={transaction.amount} />
      </View>

      <View style={styles.actionsRow}>
        {categories && onChangeCategory && (
          <Pressable onPress={() => setPickingCategory((v) => !v)} style={styles.actionBtn}>
            <Ionicons name="pricetag-outline" size={13} color="#4C1D95" />
            <Text style={styles.actionLinkText}>{pickingCategory ? "Cancel" : "Category"}</Text>
          </Pressable>
        )}
        {onToggleIgnored && (
          <Pressable onPress={() => onToggleIgnored(transaction)} style={styles.actionBtn}>
            <Ionicons
              name={transaction.ignored ? "eye-outline" : "eye-off-outline"}
              size={13}
              color="#4C1D95"
            />
            <Text style={styles.actionLinkText}>{transaction.ignored ? "Include" : "Ignore"}</Text>
          </Pressable>
        )}
        {onDelete && (
          <Pressable onPress={() => setConfirmingDelete((v) => !v)} style={styles.actionBtn}>
            <Ionicons name="trash-outline" size={13} color={DANGER} />
            <Text style={styles.deleteLinkText}>{confirmingDelete ? "Cancel" : "Delete"}</Text>
          </Pressable>
        )}
      </View>

      {confirmingDelete && onDelete && (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>Delete this transaction? This can't be undone.</Text>
          <Pressable
            onPress={() => {
              onDelete(transaction);
              setConfirmingDelete(false);
            }}
          >
            <Text style={styles.confirmDeleteText}>Yes, delete</Text>
          </Pressable>
        </View>
      )}

      {pickingCategory && categories && onChangeCategory && (
        <View style={styles.categoryRow}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              style={styles.categoryOption}
              onPress={() => {
                onChangeCategory(transaction, c.id);
                setPickingCategory(false);
              }}
            >
              <Text style={styles.categoryOptionText}>
                {getCategoryStyle(c.name).emoji} {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: neutral.card,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  ignoredCard: { opacity: 0.55 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarEmoji: { fontSize: 16 },
  merchant: { fontSize: 14, fontWeight: "600", color: neutral.textPrimary, marginBottom: 2 },
  meta: { fontSize: 12, color: neutral.textSecondary, marginBottom: 6 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.chip,
    alignSelf: "flex-start",
  },
  categoryChipEmoji: { fontSize: 12 },
  categoryChipLabel: { fontSize: 12, fontWeight: "600" },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    flexWrap: "wrap",
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: neutral.border,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionLinkText: { fontSize: 12, color: "#4C1D95", fontWeight: "600" },
  deleteLinkText: { fontSize: 12, color: DANGER, fontWeight: "600" },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: DANGER_LIGHT,
    borderRadius: radius.chip,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  confirmText: { fontSize: 12, color: DANGER, fontWeight: "600", flex: 1 },
  confirmDeleteText: { fontSize: 12, color: DANGER, fontWeight: "700", textDecorationLine: "underline" },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  categoryOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: neutral.card,
    borderWidth: 1,
    borderColor: neutral.border,
  },
  categoryOptionText: { color: neutral.textPrimary, fontWeight: "600", fontSize: 13 },
});
