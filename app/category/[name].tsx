import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { TransactionRow } from "../../components/TransactionRow";
import { getCategoryStyle } from "../../lib/categoryStyle";
import {
  deleteTransaction,
  getCategories,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
} from "../../lib/db";
import { monthRange } from "../../lib/period";
import { colors, spacing } from "../../lib/theme";
import type { Category, Transaction } from "../../lib/types";

export default function CategoryDrillDownScreen() {
  const { name, month } = useLocalSearchParams<{ name: string; month: string }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const load = useCallback(() => {
    const { start, end } = monthRange(month);
    getTransactions(db, { categoryName: name, start, end }).then(setTransactions);
    getCategories(db).then(setCategories);
  }, [db, name, month]);

  useFocusEffect(load);

  async function handleToggleIgnored(transaction: Transaction) {
    await setTransactionIgnored(db, transaction.id, !transaction.ignored);
    load();
  }

  async function handleChangeCategory(transaction: Transaction, categoryId: number) {
    await setMerchantCategory(db, transaction.merchant, categoryId);
    load();
  }

  async function handleDelete(transaction: Transaction) {
    await deleteTransaction(db, transaction.id);
    load();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: name ? `${getCategoryStyle(name).emoji} ${name}` : name }} />
      <View style={styles.container}>
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No transactions in this category.</Text>}
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              onToggleIgnored={handleToggleIgnored}
              categories={categories}
              onChangeCategory={handleChangeCategory}
              onDelete={handleDelete}
            />
          )}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
});
