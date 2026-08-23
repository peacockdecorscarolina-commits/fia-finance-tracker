import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { getAccounts, getCategories, insertCategory, insertManualTransaction } from "../lib/db";
import { getCategoryStyle } from "../lib/categoryStyle";
import { colors, radius, spacing } from "../lib/theme";
import type { Account, Category } from "../lib/types";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AddTransactionScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [isExpense, setIsExpense] = useState(true);
  const [date, setDate] = useState(today());
  const [merchant, setMerchant] = useState("Car Payment");
  const [amountText, setAmountText] = useState("");
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getAccounts(db).then((list) => {
        setAccounts(list);
        setAccountId((current) => current ?? list[0]?.id ?? null);
      });
      getCategories(db).then(async (list) => {
        let categoryList = list;
        // "Car Payment" is the main reason for this screen -- make sure it
        // exists so a first-time user isn't stuck picking "Other" instead.
        if (!categoryList.some((c) => c.name === "Car Payment")) {
          await insertCategory(db, "Car Payment").catch(() => {});
          categoryList = await getCategories(db);
        }
        setCategories(categoryList);
        setCategoryId((current) => current ?? categoryList.find((c) => c.name === "Car Payment")?.id ?? categoryList[0]?.id ?? null);
      });
    }, [db])
  );

  // Switching type swaps in a sensible category + description -- but only
  // when the field still holds the *other* type's default, so it doesn't
  // clobber something you already typed.
  const AUTO_DEFAULTS = ["Car Payment", "Paycheck", ""];
  function selectType(expense: boolean) {
    setIsExpense(expense);
    if (AUTO_DEFAULTS.includes(merchant)) {
      setMerchant(expense ? "Car Payment" : "Paycheck");
    }
    const targetCategoryName = expense ? "Car Payment" : "Income";
    const target = categories.find((c) => c.name === targetCategoryName);
    if (target) setCategoryId(target.id);
  }

  const amount = Number(amountText);
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const isValidAmount = amountText.trim() !== "" && !Number.isNaN(amount) && amount > 0;
  const canSave = accountId !== null && categoryId !== null && isValidDate && isValidAmount && merchant.trim() !== "";

  async function handleSave() {
    if (!canSave || accountId === null || categoryId === null) return;
    await insertManualTransaction(db, {
      accountId,
      date,
      merchant: merchant.trim(),
      amount: isExpense ? -amount : amount,
      categoryId,
    });
    setSaved(true);
    setAmountText("");
  }

  return (
    <Screen>
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>Add Transaction</Text>
          <Text style={styles.description}>
            For anything that doesn't come from a statement upload -- a car payment you make each
            month, or a paycheck that isn't part of any card statement.
          </Text>

          <Text style={styles.label}>Account</Text>
          <View style={styles.chipRow}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {categories.map((c) => {
              const active = c.id === categoryId;
              const { emoji } = getCategoryStyle(c.name);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {emoji} {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => selectType(true)} style={[styles.chip, isExpense && styles.chipActive]}>
              <Text style={[styles.chipText, isExpense && styles.chipTextActive]}>Expense</Text>
            </Pressable>
            <Pressable onPress={() => selectType(false)} style={[styles.chip, !isExpense && styles.chipActive]}>
              <Text style={[styles.chipText, !isExpense && styles.chipTextActive]}>Income / credit</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={merchant}
            onChangeText={setMerchant}
            style={styles.input}
            placeholder="e.g. Car Payment"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={styles.label}>Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            style={styles.input}
            placeholder="2026-08-01"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            style={styles.input}
            placeholder="450.00"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />

          <PillButton title="Save" onPress={handleSave} disabled={!canSave} />

          {saved && (
            <View style={styles.savedRow}>
              <Text style={styles.successText}>Saved.</Text>
              <Pressable onPress={() => router.back()}>
                <Text style={styles.doneLinkText}>Done</Text>
              </Pressable>
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  card: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  description: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.pillActive, borderColor: colors.pillActive },
  chipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: colors.pillActiveText },
  input: {
    backgroundColor: colors.cardSolid,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
  },
  savedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xs },
  successText: { fontSize: 13, color: colors.positive, fontWeight: "600" },
  doneLinkText: { fontSize: 13, color: colors.accent, fontWeight: "600" },
});
