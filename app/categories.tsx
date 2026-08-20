import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getCategories, insertCategory, renameCategory } from "../lib/db";
import { colors, radius, spacing } from "../lib/theme";
import type { Category } from "../lib/types";

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
    <Screen>
      <View style={styles.container}>
        <Card style={styles.formCard}>
          <Text style={styles.label}>New category</Text>
          <View style={styles.addRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Flight"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <PillButton title="Add" onPress={handleAdd} disabled={!newName.trim()} />
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </Card>

        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No categories yet.</Text>}
          renderItem={({ item }) => (
            <Card style={styles.row}>
              {editingId === item.id ? (
                <View style={styles.editRow}>
                  <TextInput
                    value={editingName}
                    onChangeText={setEditingName}
                    style={styles.input}
                    autoFocus
                  />
                  <PillButton title="Save" onPress={handleRename} disabled={!editingName.trim()} />
                  <PillButton title="Cancel" onPress={() => setEditingId(null)} variant="secondary" />
                </View>
              ) : (
                <Pressable style={styles.rowContent} onPress={() => startEditing(item)}>
                  <Text style={styles.categoryName}>
                    {getCategoryStyle(item.name).emoji} {item.name}
                  </Text>
                  <Text style={styles.editHint}>Tap to rename</Text>
                </Pressable>
              )}
            </Card>
          )}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  formCard: { gap: spacing.sm, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.cardSolid,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
  },
  errorText: { fontSize: 13, color: colors.negative },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: { flexDirection: "row", alignItems: "center" },
  rowContent: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  editRow: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  categoryName: { fontSize: 16, fontWeight: "600", color: colors.textPrimary },
  editHint: { fontSize: 12, color: colors.textSecondary },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
});
