import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card } from "../components/Card";
import { PillButton } from "../components/PillButton";
import { Screen } from "../components/Screen";
import { getAccounts, insertAccount } from "../lib/db";
import { colors, radius, spacing } from "../lib/theme";
import type { Account } from "../lib/types";

const ACCOUNT_TYPES = ["Checking", "Credit Card", "Savings", "Other"] as const;

export default function AccountsScreen() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>("Checking");

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

  return (
    <Screen>
      <View style={styles.container}>
        <Card style={styles.formCard}>
          <Text style={styles.label}>Account name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Chase Checking"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {ACCOUNT_TYPES.map((t) => {
              const active = t === type;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                    {t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <PillButton title="Add Account" onPress={handleAdd} disabled={!name.trim()} />
        </Card>

        <FlatList
          data={accounts}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No accounts yet — add one above to get started.</Text>
          }
          renderItem={({ item }) => (
            <Card style={styles.accountRow}>
              <Text style={styles.accountName}>{item.name}</Text>
              <Text style={styles.accountType}>{item.type}</Text>
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
  input: {
    backgroundColor: colors.cardSolid,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.pillActive, borderColor: colors.pillActive },
  typeChipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  typeChipTextActive: { color: colors.pillActiveText },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  accountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  accountName: { fontSize: 16, fontWeight: "600", color: colors.textPrimary },
  accountType: { fontSize: 13, color: colors.textSecondary },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.lg },
});
