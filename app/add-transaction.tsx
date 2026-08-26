import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getAccountStyle } from "../lib/accountStyle";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getAccounts, getCategories, insertCategory, insertManualTransaction } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Account, Category } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the Summary screen's redesign exactly -- same purple gradient,
// same neutral iOS-system palette, same small uppercase section labels.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AddTransactionScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        for (const name of ["Car Payment", "Cash"]) {
          if (!categoryList.some((c) => c.name === name)) {
            await insertCategory(db, name).catch(() => {});
          }
        }
        categoryList = await getCategories(db);
        setCategories(categoryList);
        setCategoryId(
          (current) => current ?? categoryList.find((c) => c.name === "Car Payment")?.id ?? categoryList[0]?.id ?? null
        );
      });
    }, [db])
  );

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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Text style={styles.title}>Add Transaction</Text>
        <Text style={styles.description}>
          Record payments, cash transactions, or anything that doesn't come from a statement.
        </Text>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.grid}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              const style = getAccountStyle(a.name);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.tile, active && styles.tileActive]}
                >
                  <View style={[styles.tileIcon, { backgroundColor: style.color }]}>
                    <Text style={styles.tileIconText}>{a.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.tileLabel, active && styles.tileLabelActive]} numberOfLines={1}>
                    {a.name}
                  </Text>
                  {active && (
                    <View style={styles.checkBadge}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.grid}>
            {categories.map((c) => {
              const active = c.id === categoryId;
              const style = getCategoryStyle(c.name);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.tile, active && styles.tileActive]}
                >
                  <Text style={styles.tileEmoji}>{style.emoji}</Text>
                  <Text style={[styles.tileLabel, active && styles.tileLabelActive]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {active && (
                    <View style={styles.checkBadge}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Type</Text>
          <View style={styles.typeRow}>
            <Pressable onPress={() => selectType(true)} style={[styles.typeCard, isExpense && styles.typeCardActive]}>
              <Ionicons name="arrow-up-outline" size={16} color={isExpense ? ACCENT : colors.textPrimary} />
              <Text style={[styles.typeCardText, isExpense && styles.typeCardTextActive]}>Expense</Text>
              {isExpense && (
                <View style={styles.typeIconBadgeExpense}>
                  <Ionicons name="chevron-down" size={12} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => selectType(false)}
              style={[styles.typeCard, !isExpense && styles.typeCardActive]}
            >
              <Ionicons name="arrow-up-outline" size={16} color={!isExpense ? ACCENT : colors.textPrimary} />
              <Text style={[styles.typeCardText, !isExpense && styles.typeCardTextActive]}>Income / credit</Text>
              {!isExpense && (
                <View style={styles.typeIconBadgeIncome}>
                  <Ionicons name="arrow-up" size={12} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Details</Text>

          <Text style={styles.fieldLabel}>Description</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              style={styles.inputText}
              placeholder="e.g. Car Payment"
              placeholderTextColor={colors.textSecondary}
            />
            {merchant.length > 0 && (
              <Pressable onPress={() => setMerchant("")}>
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>

          <View style={styles.dateAmountRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Date</Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  style={[styles.inputText, { marginLeft: 6 }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <View style={styles.inputRow}>
                <Text style={styles.dollarSign}>$</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  style={[styles.inputText, { marginLeft: 4 }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>
        </View>

        {saved ? (
          <View style={styles.savedRow}>
            <Text style={styles.successText}>Saved.</Text>
            <Pressable onPress={() => router.back()}>
              <Text style={styles.doneLinkText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={handleSave} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
            <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
              <Text style={styles.submitText}>Add Transaction</Text>
            </LinearGradient>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.xs },
  headerRow: { flexDirection: "row" },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 24, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  description: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: "31%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tileActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  tileIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  tileIconText: { color: "#FFFFFF", fontSize: 8, fontWeight: "700" },
  tileEmoji: { fontSize: 16 },
  tileLabel: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.textPrimary },
  tileLabelActive: { color: ACCENT },
  checkBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  typeRow: { flexDirection: "row", gap: spacing.sm },
  typeCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  typeCardActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  typeCardText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  typeCardTextActive: { color: ACCENT },
  typeIconBadgeExpense: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  typeIconBadgeIncome: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginTop: 6,
  },
  inputText: { flex: 1, fontSize: 15, color: colors.textPrimary },
  dollarSign: { fontSize: 15, color: colors.textSecondary, fontWeight: "600" },
  dateAmountRow: { flexDirection: "row", gap: spacing.sm },
  submitBtn: { borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", marginTop: spacing.md },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    padding: spacing.md,
  },
  successText: { fontSize: 14, color: "#16A34A", fontWeight: "700" },
  doneLinkText: { fontSize: 14, color: colors.accent, fontWeight: "700" },
  });
}
