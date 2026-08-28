import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { PressScale } from "../components/PressScale";
import { TransactionRow } from "../components/TransactionRow";
import {
  deleteTransaction,
  getAccounts,
  getCategories,
  getTransactions,
  setMerchantCategory,
  setTransactionIgnored,
} from "../lib/db";
import { radius, spacing, tabBarClearance } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Account, Category, Transaction } from "../lib/types";

const GRADIENT = ["#4C1D95", "#312E81"] as const;

export default function AllTransactionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
    getTransactions(db, { accountId: accountFilter }).then((list) => {
      setTransactions(list);
      setLoading(false);
    });
  }, [db, selectedAccountId]);

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

  const listHeader = (
    <>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>All Transactions</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {[{ id: "all" as const, name: "All" }, ...accounts].map((item) => {
          const active = item.id === selectedAccountId;
          if (active) {
            return (
              <PressScale key={String(item.id)} onPress={() => setSelectedAccountId(item.id as number | "all")}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.filterChip}>
                  <Text style={styles.filterChipTextActive}>{item.name}</Text>
                </LinearGradient>
              </PressScale>
            );
          }
          return (
            <PressScale key={String(item.id)} onPress={() => setSelectedAccountId(item.id as number | "all")}>
              <View style={styles.filterChip}>
                <Text style={styles.filterChipText}>{item.name}</Text>
              </View>
            </PressScale>
          );
        })}
      </ScrollView>

      {!loading && (
        <Text style={styles.countText}>
          {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
        </Text>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={transactions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? null : <EmptyState icon="🧾" title="No transactions here" subtitle="Nothing to show yet." />
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
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      marginBottom: spacing.md,
    },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    filterScroll: { flexGrow: 0, marginBottom: spacing.sm },
    filterRow: { gap: spacing.sm, paddingHorizontal: spacing.md },
    filterChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.card,
    },
    filterChipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
    filterChipTextActive: { color: "#FFFFFF", fontWeight: "600", fontSize: 13 },
    countText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: "600",
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    list: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: tabBarClearance },
  });
}
