import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { getAccountStyle } from "../lib/accountStyle";
import { getAccounts, insertAccount, renameAccount } from "../lib/db";
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

const TYPE_PILL_COLOR: Record<string, string> = {
  Checking: "#6D28D9",
  "Credit Card": "#2563EB",
  Savings: "#16A34A",
  Other: "#64748B",
};

export default function AccountsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]["value"]>("Checking");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const load = useCallback(() => {
    getAccounts(db).then(setAccounts);
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
  }

  async function saveEdit() {
    if (editingId === null || !editingName.trim()) return;
    await renameAccount(db, editingId, editingName.trim());
    setEditingId(null);
    load();
  }

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

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Your accounts</Text>
          {accounts.length === 0 ? (
            <Text style={styles.empty}>No accounts yet — add one above to get started.</Text>
          ) : (
            accounts.map((item, i) =>
              editingId === item.id ? (
                <View key={item.id} style={styles.editRow}>
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
                </View>
              ) : (
                <Pressable
                  key={item.id}
                  onPress={() => startEditing(item)}
                  style={[styles.accountRow, i > 0 && styles.accountRowDivider]}
                >
                  <View style={[styles.accountIcon, { backgroundColor: getAccountStyle(item.name).color }]}>
                    <Text style={styles.accountIconText}>{item.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.accountName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View
                    style={[
                      styles.typePill,
                      { backgroundColor: `${TYPE_PILL_COLOR[item.type] ?? colors.textSecondary}1A` },
                    ]}
                  >
                    <Text style={[styles.typePillText, { color: TYPE_PILL_COLOR[item.type] ?? colors.textSecondary }]}>
                      {item.type}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )
            )
          )}
        </View>

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
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  accountRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  accountIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountIconText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  accountName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  typePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  typePillText: { fontSize: 11, fontWeight: "700" },
  editRow: { gap: spacing.sm, paddingVertical: spacing.sm },
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
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.md },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontSize: 12, color: colors.textSecondary },
  });
}
