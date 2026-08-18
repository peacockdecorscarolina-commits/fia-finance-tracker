import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";
import type { Transaction } from "../lib/types";
import { AmountText } from "./AmountText";
import { Card } from "./Card";
import { Chip } from "./Chip";

export function TransactionRow({
  transaction,
  onToggleIgnored,
}: {
  transaction: Transaction;
  onToggleIgnored?: (transaction: Transaction) => void;
}) {
  return (
    <Card style={transaction.ignored ? { ...styles.card, ...styles.ignoredCard } : styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant}>{transaction.merchant}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {transaction.date} · {transaction.accountName}
            </Text>
            <Chip label={transaction.categoryName} />
            {transaction.needsReview && <Chip label="review" tone="warning" />}
            {transaction.ignored && <Chip label="ignored" />}
          </View>
        </View>
        <AmountText amount={transaction.amount} />
      </View>
      {onToggleIgnored && (
        <Pressable style={styles.ignoreLink} onPress={() => onToggleIgnored(transaction)}>
          <Text style={styles.ignoreLinkText}>
            {transaction.ignored ? "Include in totals" : "Ignore (don't count toward totals)"}
          </Text>
        </Pressable>
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
  ignoreLink: { alignSelf: "flex-start" },
  ignoreLinkText: { fontSize: 12, color: colors.accent, fontWeight: "600" },
});
