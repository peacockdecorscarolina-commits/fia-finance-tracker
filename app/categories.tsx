import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getCategories, insertCategory, renameCategory } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Category } from "../lib/types";

// Matches the Summary / Add Transaction / Accounts / Move Transactions
// screens' design system.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

export default function CategoriesScreen() {
  const db = useSQLiteContext();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getCategories(db).then(setCategories);
  }, [db]);

  useFocusEffect(load);

  async function handleAdd() {
    if (!newName.trim()) return;
    setError(null);
    try {
      await insertCategory(db, newName.trim());
      setNewName("");
      load();
    } catch {
      setError("That category already exists.");
    }
  }

  function startEditing(category: Category) {
    setEditingId(category.id);
    setEditingName(category.name);
    setError(null);
  }

  async function handleRename() {
    if (editingId === null || !editingName.trim()) return;
    setError(null);
    try {
      await renameCategory(db, editingId, editingName.trim());
      setEditingId(null);
      load();
    } catch {
      setError("That name is already used by another category.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={neutral.textPrimary} />
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

          <View style={styles.inputRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Flight"
              placeholderTextColor={neutral.textSecondary}
              style={styles.inputText}
            />
          </View>
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
                  <View style={styles.inputRow}>
                    <TextInput value={editingName} onChangeText={setEditingName} style={styles.inputText} autoFocus />
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
                  <Ionicons name="chevron-forward" size={16} color={neutral.textSecondary} />
                </Pressable>
              )
            )
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: neutral.textPrimary },
  sectionCard: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
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
    color: neutral.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  inputRow: {
    backgroundColor: neutral.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: neutral.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputText: { fontSize: 15, color: neutral.textPrimary },
  errorText: { fontSize: 12, color: "#DC2626", fontWeight: "600" },
  submitBtn: { borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  categoryRowDivider: { borderTopWidth: 1, borderTopColor: neutral.border },
  categoryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  categoryEmoji: { fontSize: 18 },
  categoryName: { flex: 1, fontSize: 15, fontWeight: "600", color: neutral.textPrimary },
  editRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  editActions: { flexDirection: "row", gap: spacing.sm },
  editCancelBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: neutral.background,
  },
  editCancelText: { fontSize: 13, fontWeight: "700", color: neutral.textSecondary },
  editSaveBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: ACCENT },
  editSaveText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  empty: { textAlign: "center", color: neutral.textSecondary, paddingVertical: spacing.md },
});
