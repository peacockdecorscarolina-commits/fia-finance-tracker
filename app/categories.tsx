import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { deleteCategory, getCategories, insertCategory, renameCategory, setCategoryEmoji } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Category } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the Summary / Add Transaction / Accounts / Move Transactions
// screens' design system.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingEmoji, setEditingEmoji] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getCategories(db).then(setCategories);
  }, [db]);

  useFocusEffect(load);

  async function handleAdd() {
    if (!newName.trim()) return;
    setError(null);
    try {
      await insertCategory(db, newName.trim(), newEmoji.trim() || null);
      setNewName("");
      setNewEmoji("");
      load();
    } catch {
      setError("That category already exists.");
    }
  }

  function startEditing(category: Category) {
    setEditingId(category.id);
    setEditingName(category.name);
    setEditingEmoji(category.emoji ?? "");
    setConfirmingDeleteId(null);
    setError(null);
  }

  async function handleRename() {
    if (editingId === null || !editingName.trim()) return;
    setError(null);
    try {
      await renameCategory(db, editingId, editingName.trim());
      await setCategoryEmoji(db, editingId, editingName.trim(), editingEmoji.trim() || null);
      setEditingId(null);
      load();
    } catch {
      setError("That name is already used by another category.");
    }
  }

  async function handleDelete(id: number) {
    await deleteCategory(db, id);
    setConfirmingDeleteId(null);
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
          <Text style={styles.headerTitle}>Categories</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.formHeaderRow}>
            <Text style={styles.sectionTitle}>Add new category</Text>
            <View style={styles.formIcon}>
              <Ionicons name="pricetag-outline" size={18} color={ACCENT} />
            </View>
          </View>

          <View style={styles.addFormRow}>
            <View style={styles.emojiInputRow}>
              <TextInput
                value={newEmoji}
                onChangeText={setNewEmoji}
                placeholder="🏷️"
                placeholderTextColor={colors.textSecondary}
                style={styles.emojiInputText}
              />
            </View>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Flight"
                placeholderTextColor={colors.textSecondary}
                style={styles.inputText}
              />
            </View>
          </View>
          <Text style={styles.hint}>Optional: pick your own emoji, or leave blank for an automatic one.</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable onPress={handleAdd} disabled={!newName.trim()} style={{ opacity: newName.trim() ? 1 : 0.5 }}>
            <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtn}>
              <Text style={styles.submitText}>Add Category</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Your categories</Text>
          {categories.length === 0 ? (
            <Text style={styles.empty}>No categories yet — add your first one above.</Text>
          ) : (
            categories.map((item, i) =>
              editingId === item.id ? (
                <View key={item.id} style={styles.editRow}>
                  <View style={styles.addFormRow}>
                    <View style={styles.emojiInputRow}>
                      <TextInput value={editingEmoji} onChangeText={setEditingEmoji} placeholder="🏷️" placeholderTextColor={colors.textSecondary} style={styles.emojiInputText} />
                    </View>
                    <View style={[styles.inputRow, { flex: 1 }]}>
                      <TextInput value={editingName} onChangeText={setEditingName} style={styles.inputText} autoFocus />
                    </View>
                  </View>
                  {error && <Text style={styles.errorText}>{error}</Text>}
                  <View style={styles.editActions}>
                    <Pressable onPress={() => setEditingId(null)} style={styles.editCancelBtn}>
                      <Text style={styles.editCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleRename}
                      disabled={!editingName.trim()}
                      style={[styles.editSaveBtn, !editingName.trim() && { opacity: 0.5 }]}
                    >
                      <Text style={styles.editSaveText}>Save</Text>
                    </Pressable>
                  </View>

                  {item.name.trim().toLowerCase() !== "other" &&
                    (confirmingDeleteId !== item.id ? (
                      <Pressable onPress={() => setConfirmingDeleteId(item.id)} style={styles.deleteLink}>
                        <Ionicons name="trash-outline" size={14} color="#DC2626" />
                        <Text style={styles.deleteLinkText}>Delete this category</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.confirmBox}>
                        <Text style={styles.confirmText}>
                          This will delete "{item.name}" and move any transactions in it to "Other". This can't be
                          undone.
                        </Text>
                        <View style={styles.editActions}>
                          <Pressable onPress={() => setConfirmingDeleteId(null)} style={styles.editCancelBtn}>
                            <Text style={styles.editCancelText}>Cancel</Text>
                          </Pressable>
                          <Pressable onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
                            <Text style={styles.deleteBtnText}>Yes, delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                </View>
              ) : (
                <Pressable
                  key={item.id}
                  onPress={() => startEditing(item)}
                  style={[styles.categoryRow, i > 0 && styles.categoryRowDivider]}
                >
                  <View style={[styles.categoryIcon, { backgroundColor: getCategoryStyle(item.name).color }]}>
                    <Text style={styles.categoryEmoji}>{getCategoryStyle(item.name).emoji}</Text>
                  </View>
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )
            )
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
  inputRow: {
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { fontSize: 15, color: colors.textPrimary },
  addFormRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  emojiInputRow: {
    width: 52,
    backgroundColor: colors.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    alignItems: "center",
  },
  emojiInputText: { fontSize: 18, textAlign: "center", color: colors.textPrimary },
  hint: { fontSize: 11, color: colors.textSecondary },
  errorText: { fontSize: 12, color: "#DC2626", fontWeight: "600" },
  submitBtn: { borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  categoryRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  categoryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  categoryEmoji: { fontSize: 18 },
  categoryName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
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
  deleteLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.xs },
  deleteLinkText: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  confirmBox: { backgroundColor: "#FEE2E2", borderRadius: radius.chip, padding: spacing.md, gap: spacing.sm },
  confirmText: { fontSize: 13, color: "#DC2626", fontWeight: "600" },
  deleteBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: "#DC2626" },
  deleteBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  empty: { textAlign: "center", color: colors.textSecondary, paddingVertical: spacing.md },
  });
}
