import { StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";
import type { Transaction } from "../lib/types";
import { AmountText } from "./AmountText";
import { Card } from "./Card";
import { Chip } from "./Chip";

export function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.merchant}>{transaction.merchant}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {transaction.date} · {transaction.accountName}
          </Text>
          <Chip label={transaction.categoryName} />
          {transaction.needsReview && <Chip label="review" tone="warning" />}
        </View>
      </View>
      <AmountText amount={transaction.amount} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  merchant: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { fontSize: 12, color: colors.textSecondary, marginRight: 4 },
});
