import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LineChart } from "../../components/LineChart";
import { addAssetBalance, deleteAsset, deleteAssetBalance, getAssetBalances, getAssets, renameAsset } from "../../lib/db";
import { radius, spacing } from "../../lib/theme";
import { useTheme, type ThemeColors } from "../../lib/ThemeContext";
import type { Asset, AssetBalanceEntry, AssetType } from "../../lib/types";

// Matches the rest of the app's redesigned screens -- theme-invariant.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChartDate(date: string): string {
  const [year, m] = date.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

function formatEntryDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const TYPE_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵" };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [entries, setEntries] = useState<AssetBalanceEntry[]>([]);
  const [updating, setUpdating] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [dateInput, setDateInput] = useState(todayISO());
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(() => {
    const assetId = Number(id);
    getAssets(db).then((list) => setAsset(list.find((a) => a.id === assetId) ?? null));
    getAssetBalances(db, assetId).then((list) => setEntries([...list].reverse()));
  }, [db, id]);

  useFocusEffect(load);

  const currentBalance = entries[0]?.balance ?? 0;
  const firstBalance = entries[entries.length - 1]?.balance ?? currentBalance;
  const delta = currentBalance - firstBalance;
  const pct = firstBalance !== 0 ? (delta / firstBalance) * 100 : 0;
  const isBalanceInputValid = Number.isFinite(Number(balanceInput)) && /^\d{4}-\d{2}-\d{2}$/.test(dateInput);

  async function handleUpdate() {
    const value = Number(balanceInput);
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    await addAssetBalance(db, Number(id), dateInput, value);
    setUpdating(false);
    setBalanceInput("");
    load();
  }

  async function handleDeleteEntry(entryId: number) {
    await deleteAssetBalance(db, entryId);
    load();
  }

  async function handleRename() {
    if (!nameInput.trim()) return;
    await renameAsset(db, Number(id), nameInput.trim());
    setRenaming(false);
    load();
  }

  async function handleDeleteAsset() {
    await deleteAsset(db, Number(id));
    router.back();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {asset ? `${TYPE_ICON[asset.type]} ${asset.name}` : "Account"}
          </Text>
          <Pressable
            onPress={() => {
              setNameInput(asset?.name ?? "");
              setRenaming(true);
            }}
            style={styles.headerBtn}
          >
            <Ionicons name="pencil" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        {renaming && (
          <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel}>Rename account</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputText}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Account name"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>
            <View style={styles.updateActions}>
              <Pressable onPress={() => setRenaming(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleRename} disabled={!nameInput.trim()} style={{ flex: 1, opacity: nameInput.trim() ? 1 : 0.5 }}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </View>

            {!confirmingDelete ? (
              <Pressable onPress={() => setConfirmingDelete(true)} style={styles.deleteLink}>
                <Ionicons name="trash-outline" size={14} color="#DC2626" />
                <Text style={styles.deleteLinkText}>Delete this account</Text>
              </Pressable>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  This will permanently delete "{asset?.name}" and all of its balance history. This can't be undone.
                </Text>
                <View style={styles.confirmRow}>
                  <Pressable onPress={() => setConfirmingDelete(false)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleDeleteAsset} style={[styles.deleteBtn, { flex: 1 }]}>
                    <Text style={styles.deleteBtnText}>Yes, delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroLabel}>Current balance</Text>
          <Text style={styles.heroValue}>{formatMoney(currentBalance)}</Text>
          {entries.length >= 2 && (
            <View style={styles.heroDeltaPill}>
              <Text style={[styles.heroDeltaText, { color: delta >= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%)
              </Text>
              <Text style={styles.heroDeltaSub}>Since first entry</Text>
            </View>
          )}
        </LinearGradient>

        {updating ? (
          <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel}>New balance</Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={[styles.inputText, { marginLeft: 4 }]}
                value={balanceInput}
                onChangeText={setBalanceInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                autoFocus
              />
            </View>
            <Text style={styles.fieldLabel}>As of date</Text>
            <View style={styles.inputRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.inputText, { marginLeft: 6 }]}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            <View style={styles.updateActions}>
              <Pressable onPress={() => setUpdating(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleUpdate}
                disabled={!isBalanceInputValid}
                style={{ flex: 1, opacity: isBalanceInputValid ? 1 : 0.5 }}
              >
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setBalanceInput(currentBalance ? String(currentBalance) : "");
              setDateInput(todayISO());
              setUpdating(true);
            }}
            style={styles.updateBtn}
          >
            <Ionicons name="refresh" size={18} color={colors.accent} />
            <Text style={styles.updateBtnText}>Update balance</Text>
          </Pressable>
        )}

        {entries.length >= 2 ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Balance over time</Text>
            <LineChart
              points={[...entries].reverse().map((e) => e.balance)}
              labels={[...entries].reverse().map((e) => formatChartDate(e.date))}
              color={colors.accent}
              width={320}
            />
          </View>
        ) : entries.length === 1 ? (
          <View style={styles.sectionCard}>
            <Text style={styles.chartHintText}>
              Add one more balance entry (e.g. an earlier date) to see a trend graph here.
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>History</Text>
          {entries.length === 0 ? (
            <Text style={styles.emptyText}>No balance logged yet. Tap "Update balance" to add the first entry.</Text>
          ) : (
            entries.map((e, i) => (
              <View key={e.id} style={[styles.entryRow, i > 0 && styles.entryRowDivider]}>
                <View style={styles.entryIcon}>
                  <Ionicons name="calendar-outline" size={14} color={ACCENT} />
                </View>
                <Text style={styles.entryDate}>{formatEntryDate(e.date)}</Text>
                <Text style={styles.entryBalance}>{formatMoney(e.balance)}</Text>
                <Pressable onPress={() => handleDeleteEntry(e.id)}>
                  <Ionicons name="trash-outline" size={16} color="#DC2626" />
                </Pressable>
              </View>
            ))
          )}
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
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: 4 },
  heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 30, fontWeight: "700", color: "#FFFFFF" },
  heroDeltaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF1A",
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  heroDeltaText: { fontSize: 12, fontWeight: "700" },
  heroDeltaSub: { fontSize: 11, color: "#FFFFFFCC" },
  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    paddingVertical: spacing.md,
  },
  updateBtnText: { fontSize: 15, fontWeight: "700", color: colors.accent },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
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
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { flex: 1, fontSize: 15, color: colors.textPrimary },
  dollarSign: { fontSize: 15, color: colors.textSecondary, fontWeight: "600" },
  updateActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  saveBtn: { borderRadius: radius.pill, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  chartHintText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center", paddingVertical: spacing.sm },
  entryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  entryRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  entryIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  entryDate: { flex: 1, fontSize: 13, color: colors.textSecondary },
  entryBalance: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  deleteLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  deleteLinkText: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  confirmBox: { backgroundColor: "#FEE2E2", borderRadius: radius.chip, padding: spacing.md, gap: spacing.sm, marginTop: spacing.xs },
  confirmText: { fontSize: 13, color: "#DC2626", fontWeight: "600" },
  confirmRow: { flexDirection: "row", gap: spacing.sm },
  deleteBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: "#DC2626",
  },
  deleteBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  });
}
