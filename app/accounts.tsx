import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { getAccountCardColor } from "../lib/accountStyle";
import { darken } from "../lib/color";
import {
  deleteAccount,
  getAccountBalances,
  getAccounts,
  getAccountSpendSummary,
  insertAccount,
  renameAccount,
  setAccountBalanceCheckpoint,
  setAccountCardProduct,
} from "../lib/db";
import { CARD_CATALOG } from "../lib/cardBenefits";
import { getPeriodRange } from "../lib/period";
import { radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the Summary / Add Transaction screens' design system.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const ACCOUNT_TYPES = [
  { value: "Checking", icon: "card-outline" as const },
  { value: "Credit Card", icon: "card" as const },
  { value: "Savings", icon: "wallet-outline" as const },
  { value: "Other", icon: "ellipsis-horizontal-circle-outline" as const },
];

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [spendByAccount, setSpendByAccount] = useState<Record<number, number>>({});
  const [balanceByAccount, setBalanceByAccount] = useState<Record<number, number>>({});
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]["value"]>("Checking");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [balanceDateInput, setBalanceDateInput] = useState("");

  const load = useCallback(() => {
    getAccounts(db).then(async (list) => {
      setAccounts(list);
      const { start, end } = getPeriodRange("Month");
      const entries = await Promise.all(
        list.map(async (a) => [a.id, (await getAccountSpendSummary(db, a.id, start, end)).spent] as const)
      );
      setSpendByAccount(Object.fromEntries(entries));
      getAccountBalances(db).then(setBalanceByAccount);
    });
  }, [db]);

  useFocusEffect(load);

  async function handleAdd() {
    if (!name.trim()) return;
    await insertAccount(db, name.trim(), type);
    setName("");
    load();
  }

  function startEditing(account: Account) {
    setEditingId(account.id);
    setEditingName(account.name);
    setConfirmingDeleteId(null);
    setEditingBalance(false);
    setBalanceInput(account.startingBalance !== null ? String(account.startingBalance) : "");
    setBalanceDateInput(account.startingBalanceDate ?? new Date().toISOString().slice(0, 10));
  }

  async function saveEdit() {
    if (editingId === null || !editingName.trim()) return;
    await renameAccount(db, editingId, editingName.trim());
    setEditingId(null);
    load();
  }

  const isBalanceInputValid =
    Number.isFinite(Number(balanceInput)) && balanceInput.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(balanceDateInput);

  async function saveBalance() {
    if (editingId === null || !isBalanceInputValid) return;
    await setAccountBalanceCheckpoint(db, editingId, Number(balanceInput), balanceDateInput);
    setEditingBalance(false);
    load();
  }

  async function chooseCardProduct(productId: string | null) {
    if (editingId === null) return;
    await setAccountCardProduct(db, editingId, productId);
    load();
  }

  async function handleDelete(id: number) {
    await deleteAccount(db, id);
    setConfirmingDeleteId(null);
    setEditingId(null);
    load();
  }

  const editingAccount = accounts.find((a) => a.id === editingId) ?? null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Accounts</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.formHeaderRow}>
            <Text style={styles.sectionTitle}>Add new account</Text>
            <View style={styles.formIcon}>
              <Ionicons name="business-outline" size={18} color={ACCENT} />
            </View>
          </View>

          <Text style={styles.fieldLabel}>Account name</Text>
          <View style={styles.inputRow}>
            <Ionicons name="business-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Chase Checking"
              placeholderTextColor={colors.textSecondary}
              style={styles.inputText}
            />
          </View>

          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.typeGrid}>
            {ACCOUNT_TYPES.map((t) => {
              const active = t.value === type;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setType(t.value)}
                  style={[styles.typeTile, active && styles.typeTileActive]}
                >
                  <View style={[styles.typeIconWrap, active && styles.typeIconWrapActive]}>
                    <Ionicons name={t.icon} size={20} color={active ? ACCENT : colors.textSecondary} />
                  </View>
                  <Text style={[styles.typeTileText, active && styles.typeTileTextActive]}>{t.value}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={handleAdd} disabled={!name.trim()} style={{ opacity: name.trim() ? 1 : 0.5 }}>
            <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
              <Text style={styles.submitText}>Add Account</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View>
          <View style={styles.stackHeaderRow}>
            <Text style={styles.sectionTitle}>Your accounts</Text>
            {accounts.length > 1 && <Text style={styles.stackHint}>Tap a card to edit or delete it</Text>}
          </View>

          {accounts.length === 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.empty}>No accounts yet — add one above to get started.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {accounts.map((a) => {
                const spend = spendByAccount[a.id] ?? 0;
                const balance = balanceByAccount[a.id];
                const color = getAccountCardColor(a.name, accounts);
                const initials = a.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 3)
                  .toUpperCase();
                return (
                  <Pressable key={a.id} onPress={() => startEditing(a)}>
                    <LinearGradient
                      colors={[color, darken(color, 40)]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.accountRow}
                    >
                      <View style={styles.accountBadge}>
                        <Text style={styles.accountBadgeText}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.accountRowName} numberOfLines={1}>
                          {a.name}
                        </Text>
                        <Text style={styles.accountRowSub}>{a.type}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.accountRowAmount}>
                          {balance !== undefined ? formatMoney(balance) : formatMoney(spend)}
                        </Text>
                        <Text style={styles.accountRowSub}>{balance !== undefined ? "balance" : "this month"}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {editingAccount && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Edit "{editingAccount.name}"</Text>
            <View style={styles.inputRow}>
              <TextInput value={editingName} onChangeText={setEditingName} style={styles.inputText} autoFocus />
            </View>
            <View style={styles.editActions}>
              <Pressable onPress={() => setEditingId(null)} style={styles.editCancelBtn}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                disabled={!editingName.trim()}
                style={[styles.editSaveBtn, !editingName.trim() && { opacity: 0.5 }]}
              >
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            </View>

            <View style={styles.balanceSection}>
              <Text style={styles.fieldLabel}>Which card is this?</Text>
              <Text style={styles.cardHint}>Picking the real card adds its benefits and annual fee.</Text>
              <View style={styles.cardChoiceRow}>
                {[{ id: null, name: "Not listed / none" }, ...CARD_CATALOG].map((c) => {
                  const active = (editingAccount.cardProduct ?? null) === c.id;
                  return (
                    <Pressable
                      key={c.id ?? "none"}
                      onPress={() => chooseCardProduct(c.id)}
                      style={[styles.cardChoice, active && styles.cardChoiceActive]}
                    >
                      <Text style={[styles.cardChoiceText, active && styles.cardChoiceTextActive]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.balanceSection}>
              {editingBalance ? (
                <>
                  <Text style={styles.fieldLabel}>Balance</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      value={balanceInput}
                      onChangeText={setBalanceInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 5000"
                      placeholderTextColor={colors.textSecondary}
                      style={styles.inputText}
                    />
                  </View>
                  <Text style={styles.fieldLabel}>As of (YYYY-MM-DD)</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      value={balanceDateInput}
                      onChangeText={setBalanceDateInput}
                      placeholder="2026-10-22"
                      placeholderTextColor={colors.textSecondary}
                      style={styles.inputText}
                    />
                  </View>
                  <View style={styles.editActions}>
                    <Pressable onPress={() => setEditingBalance(false)} style={styles.editCancelBtn}>
                      <Text style={styles.editCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={saveBalance}
                      disabled={!isBalanceInputValid}
                      style={[styles.editSaveBtn, !isBalanceInputValid && { opacity: 0.5 }]}
                    >
                      <Text style={styles.editSaveText}>Save</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable onPress={() => setEditingBalance(true)} style={styles.balanceLink}>
                  <Ionicons name="wallet-outline" size={14} color={ACCENT} />
                  <Text style={styles.balanceLinkText}>
                    {editingAccount.startingBalance !== null
                      ? `Balance: ${formatMoney(balanceByAccount[editingAccount.id] ?? editingAccount.startingBalance)} — edit`
                      : "Set a starting balance to track this account's running balance"}
                  </Text>
                </Pressable>
              )}
            </View>

            {confirmingDeleteId !== editingAccount.id ? (
              <Pressable onPress={() => setConfirmingDeleteId(editingAccount.id)} style={styles.deleteLink}>
                <Ionicons name="trash-outline" size={14} color="#DC2626" />
                <Text style={styles.deleteLinkText}>Delete this account</Text>
              </Pressable>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  This will permanently delete "{editingAccount.name}" and all of its transactions. This can't be
                  undone.
                </Text>
                <View style={styles.editActions}>
                  <Pressable onPress={() => setConfirmingDeleteId(null)} style={styles.editCancelBtn}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDelete(editingAccount.id)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>Yes, delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.footerRow}>
          <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
          <Text style={styles.footerText}>Your data is encrypted and secure</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  formHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  formIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: ACCENT_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  stackHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  stackHint: { fontSize: 11, color: colors.textSecondary },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.xs },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { flex: 1, fontSize: 15, color: colors.textPrimary },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeTile: {
    flexGrow: 1,
    flexBasis: "22%",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  typeTileActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  typeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  typeIconWrapActive: { backgroundColor: "#FFFFFF" },
  typeTileText: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },
  typeTileTextActive: { color: ACCENT },
  submitBtn: { borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  editActions: { flexDirection: "row", gap: spacing.sm },
  editCancelBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  editCancelText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  editSaveBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: ACCENT },
  editSaveText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  cardHint: { fontSize: 12, color: colors.textSecondary },
  cardChoiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cardChoice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cardChoiceActive: { borderColor: ACCENT, backgroundColor: "#EDE9FE" },
  cardChoiceText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  cardChoiceTextActive: { color: ACCENT },
  balanceSection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  balanceLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  balanceLinkText: { flex: 1, fontSize: 12, fontWeight: "600", color: ACCENT },
  deleteLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.xs,
  },
  deleteLinkText: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  confirmBox: { backgroundColor: "#FEE2E2", borderRadius: radius.chip, padding: spacing.md, gap: spacing.sm },
  confirmText: { fontSize: 13, color: "#DC2626", fontWeight: "600" },
  deleteBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: "#DC2626",
  },
  deleteBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.md },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  accountBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  accountBadgeText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  accountRowName: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  accountRowSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  accountRowAmount: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontSize: 12, color: colors.textSecondary },
  });
}
