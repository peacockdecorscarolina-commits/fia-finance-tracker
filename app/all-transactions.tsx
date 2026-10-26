import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { formatAmount } from "../components/AmountText";
import { EmptyState } from "../components/EmptyState";
import { PressScale } from "../components/PressScale";
import { TransactionRow } from "../components/TransactionRow";
import {
  deleteTransaction,
  getAccounts,
  getAllTags,
  getCategories,
  getTransactions,
  getTransferCandidates,
  INCOME_CATEGORY_NAME,
  linkTransactions,
  PAYMENT_CATEGORY_NAME,
  setMerchantCategory,
  setTransactionIgnored,
  unlinkTransaction,
} from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing, tabBarClearance } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Account, Category, Transaction } from "../lib/types";

const GRADIENT = ["#4C1D95", "#312E81"] as const;

// Empty or non-numeric input means "no limit" on that side of the range.
function parseAmountInput(value: string): number | null {
  const n = parseFloat(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function AllTransactionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const { start, end, categoryName, mode, search, tag: tagParam } = useLocalSearchParams<{
    start?: string;
    end?: string;
    categoryName?: string;
    mode?: string;
    // "1" when opened from the More menu's Search item -- starts with the
    // search panel open and focused.
    search?: string;
    // Set when a tag chip on a transaction was tapped -- filters to that tag.
    tag?: string;
  }>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(search === "1" || !!tagParam);
  const [query, setQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(tagParam ?? null);
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);

  const load = useCallback(() => {
    const accountFilter = selectedAccountId === "all" ? undefined : selectedAccountId;
    getAccounts(db).then(setAccounts);
    getCategories(db).then(setCategories);
    getAllTags(db).then(setAllTags);
    getTransactions(db, {
      accountId: accountFilter,
      start,
      end,
      categoryName,
      excludeCategoryNames: mode === "expenses" ? [INCOME_CATEGORY_NAME, PAYMENT_CATEGORY_NAME] : undefined,
      paymentCategoriesOnly: mode === "payments",
    }).then((list) => {
      setTransactions(list);
      setLoading(false);
    });
  }, [db, selectedAccountId, start, end, categoryName, mode]);

  useFocusEffect(load);

  // Filtered in memory rather than in SQL: the list is already loaded, so
  // typing doesn't need a query per keystroke. Matches the raw statement
  // text, the cleaned-up display name (so "starb" finds "SQ *STARBUCKS #12"),
  // and the transaction's note and tags.
  // The amount range compares the size of the amount, ignoring sign, so
  // "20 to 50" catches purchases and refunds alike.
  const min = parseAmountInput(minAmount);
  const max = parseAmountInput(maxAmount);
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const isFiltering = needle !== "" || min !== null || max !== null || selectedTag !== null;
  const visibleTransactions = useMemo(() => {
    if (!isFiltering) return transactions;
    return transactions.filter((t) => {
      if (selectedTag && !t.tags.includes(selectedTag)) return false;
      if (
        needle &&
        !t.merchant.toLowerCase().includes(needle) &&
        !formatMerchantName(t.merchant).toLowerCase().includes(needle) &&
        !(t.note ?? "").toLowerCase().includes(needle) &&
        !t.tags.some((tag) => tag.includes(needle))
      ) {
        return false;
      }
      const size = Math.abs(t.amount);
      if (min !== null && size < min) return false;
      if (max !== null && size > max) return false;
      return true;
    });
  }, [transactions, isFiltering, needle, min, max, selectedTag]);
  const visibleTotal = visibleTransactions.reduce((sum, t) => sum + t.amount, 0);

  // Closing the panel clears it, so no filter keeps applying out of sight.
  function toggleSearch() {
    if (searchOpen) {
      setQuery("");
      setMinAmount("");
      setMaxAmount("");
      setSelectedTag(null);
    }
    setSearchOpen(!searchOpen);
  }

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

  async function handleLinkTransfer(transaction: Transaction, candidateId: number) {
    await linkTransactions(db, transaction.id, candidateId);
    load();
  }

  async function handleUnlinkTransfer(transaction: Transaction) {
    await unlinkTransaction(db, transaction.id);
    load();
  }

  const screenTitle =
    categoryName ??
    (mode === "expenses"
      ? "Expenses"
      : mode === "payments"
        ? "Payments"
        : search === "1"
          ? "Search"
          : "All Transactions");

  const listHeader = (
    <>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{screenTitle}</Text>
        <Pressable onPress={toggleSearch} style={styles.headerBtn}>
          <Ionicons name={searchOpen ? "close" : "search"} size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      {searchOpen && (
        <View style={styles.searchSection}>
          <View style={styles.inputRow}>
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search vendor, note or #tag"
              placeholderTextColor={colors.textSecondary}
              style={[styles.inputText, { marginLeft: 6 }]}
              autoFocus={!tagParam}
              autoComplete="off"
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              textContentType="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <View style={styles.amountRow}>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                value={minAmount}
                onChangeText={setMinAmount}
                placeholder="Min"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 4 }]}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.toText}>to</Text>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                value={maxAmount}
                onChangeText={setMaxAmount}
                placeholder="Max"
                placeholderTextColor={colors.textSecondary}
                style={[styles.inputText, { marginLeft: 4 }]}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {allTags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagFilterRow}>
              {allTags.map(({ name, count }) => {
                const active = name === selectedTag;
                return (
                  <Pressable
                    key={name}
                    onPress={() => setSelectedTag(active ? null : name)}
                    style={[styles.tagFilterChip, active && styles.tagFilterChipActive]}
                  >
                    <Text style={[styles.tagFilterText, active && styles.tagFilterTextActive]}>
                      #{name} · {count}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

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
          {visibleTransactions.length} transaction{visibleTransactions.length === 1 ? "" : "s"}
          {isFiltering && ` · ${formatAmount(visibleTotal)} total`}
        </Text>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={visibleTransactions}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? null : isFiltering ? (
            <EmptyState icon="🔍" title="No matches" subtitle="Try a different vendor, tag or amount range." />
          ) : (
            <EmptyState icon="🧾" title="No transactions here" subtitle="Nothing to show yet." />
          )
        }
        renderItem={({ item }) => (
          <TransactionRow
            transaction={item}
            onToggleIgnored={handleToggleIgnored}
            categories={categories}
            onChangeCategory={handleChangeCategory}
            onDelete={handleDelete}
            onFindTransferCandidates={(t) => getTransferCandidates(db, t)}
            onLinkTransfer={handleLinkTransfer}
            onUnlinkTransfer={handleUnlinkTransfer}
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
    searchSection: { gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.md },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    inputText: { flex: 1, fontSize: 14, color: colors.textPrimary },
    amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    tagFilterRow: { gap: spacing.sm },
    tagFilterChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    tagFilterChipActive: { backgroundColor: "#EDE9FE", borderColor: "#4C1D95" },
    tagFilterText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
    tagFilterTextActive: { color: "#4C1D95" },
    dollarSign: { fontSize: 14, color: colors.textSecondary, fontWeight: "600" },
    toText: { color: colors.textSecondary, fontWeight: "600" },
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
