import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { TransactionRow } from "../../components/TransactionRow";
import { getAccountStyle } from "../../lib/accountStyle";
import {
  deleteTransaction,
  getAccounts,
  getCategories,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
} from "../../lib/db";
import { monthRange } from "../../lib/period";
import { radius, spacing } from "../../lib/theme";
import type { Account, Category, Transaction } from "../../lib/types";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function AccountDrillDownScreen() {
  const { name, month } = useLocalSearchParams<{ name: string; month: string }>();
  const db = useSQLiteContext();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [account, setAccount] = useState<Account | null>(null);

  const load = useCallback(() => {
    getAccounts(db).then((accounts) => {
      const found = accounts.find((a) => a.name === name) ?? null;
      setAccount(found);
      if (found) {
        const { start, end } = monthRange(month);
        getTransactions(db, { accountId: found.id, start, end }).then(setTransactions);
      }
    });
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

  const style = getAccountStyle(name ?? "");
  const spent = transactions
    .filter((t) => !t.ignored && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const listHeader = (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <Text style={styles.heroLabel}>Spent in {month ? formatMonthLabel(month) : "this period"}</Text>
      <Text style={styles.heroValue}>{formatMoney(spent)}</Text>
    </LinearGradient>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={neutral.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name ? `${style.emoji} ${name}` : "Account"}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <FlatList
          style={styles.mainList}
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No transactions on this card.</Text>
            </View>
          }
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
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: neutral.textPrimary },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: 4, marginBottom: spacing.md },
  heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  mainList: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  emptyCard: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.lg, alignItems: "center" },
  emptyText: { fontSize: 13, color: neutral.textSecondary, textAlign: "center" },
});
