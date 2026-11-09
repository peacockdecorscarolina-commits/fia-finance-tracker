import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { autoBackup } from "../lib/autoBackup";
import { addPerson, deletePerson, getAccountDefaults, renamePerson, setAccountDefaultPerson } from "../lib/db";
import { NAME_MAX, personNameProblem, SHARED, type Person } from "../lib/people";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import { usePeople } from "../lib/usePeople";

const ACCENT = "#4C1D95";
const DANGER = "#DC2626";

type Card = { id: number; name: string; defaultPersonId: number | null };

// For people sharing cards or money: who's in the household, and who usually
// uses each card. With only "Me" here, none of this shows elsewhere in Fia.
export default function PeopleScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const people = usePeople();
  const [cards, setCards] = useState<Card[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string; error: string | null } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const loadCards = useCallback(() => {
    getAccountDefaults(db).then(setCards);
  }, [db]);

  useFocusEffect(loadCards);

  async function add() {
    const problem = personNameProblem(name, people.map((p) => p.name));
    setError(problem);
    if (problem) return;
    await addPerson(db, name);
    setName("");
    autoBackup(db);
  }

  async function saveRename(person: Person) {
    if (!editing) return;
    const problem = personNameProblem(editing.name, people.filter((p) => p.id !== person.id).map((p) => p.name));
    if (problem) {
      setEditing({ ...editing, error: problem });
      return;
    }
    await renamePerson(db, person.id, editing.name);
    setEditing(null);
    autoBackup(db);
  }

  async function remove(person: Person) {
    if (confirmingDelete !== person.id) {
      setConfirmingDelete(person.id);
      return;
    }
    await deletePerson(db, person.id);
    setConfirmingDelete(null);
    loadCards();
    autoBackup(db);
  }

  async function setCardPerson(card: Card, personId: number | null) {
    await setAccountDefaultPerson(db, card.id, personId);
    loadCards();
    autoBackup(db);
  }

  const cardChoices: { id: number | null; label: string }[] = [
    { id: null, label: "No one" },
    ...people.map((p) => ({ id: p.id, label: p.name })),
    { id: SHARED, label: "Shared" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>People</Text>
          <View style={styles.headerBtn} />
        </View>

        <Text style={styles.intro}>
          Sharing a card or your money with someone? Add them here to track who spent what and see who owes whom.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>People</Text>
          {people.map((p) => (
            <View key={p.id} style={styles.personBlock}>
              {editing?.id === p.id ? (
                <>
                  <View style={styles.row}>
                    <TextInput
                      value={editing.name}
                      onChangeText={(v) => setEditing({ ...editing, name: v, error: null })}
                      maxLength={NAME_MAX}
                      autoFocus
                      style={[styles.input, { flex: 1 }]}
                      accessibilityLabel={`New name for ${p.name}`}
                    />
                    <Pressable onPress={() => saveRename(p)} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                      <Text style={styles.cancel}>Cancel</Text>
                    </Pressable>
                  </View>
                  {editing.error && <Text style={styles.error}>{editing.error}</Text>}
                </>
              ) : (
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{p.name.trim()[0]?.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.personName} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Pressable onPress={() => setEditing({ id: p.id, name: p.name, error: null })} hitSlop={8} accessibilityLabel={`Rename ${p.name}`}>
                    <Text style={styles.link}>Rename</Text>
                  </Pressable>
                  {!p.isMe && (
                    <Pressable onPress={() => remove(p)} hitSlop={8} accessibilityLabel={`Remove ${p.name}`}>
                      {confirmingDelete === p.id ? (
                        <Text style={styles.danger}>Remove?</Text>
                      ) : (
                        <Ionicons name="trash-outline" size={16} color={DANGER} />
                      )}
                    </Pressable>
                  )}
                </View>
              )}
              {confirmingDelete === p.id && (
                <Text style={styles.hint}>Their transactions stay in Fia and go back to having no one on them.</Text>
              )}
            </View>
          ))}
          <View style={[styles.row, { marginTop: spacing.xs }]}>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              onSubmitEditing={add}
              maxLength={NAME_MAX}
              placeholder="Add someone, e.g. Sarah"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable onPress={add} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Add</Text>
            </Pressable>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        {people.length > 1 && cards.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Who usually uses each card?</Text>
            <Text style={styles.hint}>New charges on the card go to this person, unless you’ve set someone for that store.</Text>
            {cards.map((c) => (
              <View key={c.id} style={{ gap: 6, marginTop: spacing.xs }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {c.name}
                </Text>
                <View style={styles.chipRow}>
                  {cardChoices.map((choice) => {
                    const on = c.defaultPersonId === choice.id;
                    return (
                      <Pressable
                        key={String(choice.id)}
                        onPress={() => setCardPerson(c, choice.id)}
                        style={[styles.chip, on && styles.chipOn]}
                        accessibilityLabel={`${c.name}: ${choice.label}`}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{choice.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}

        {people.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How it works</Text>
            <Text style={styles.hint}>
              Tap Person on any transaction to choose who it belongs to, or mark it Shared. Fia remembers the store for
              next time.
            </Text>
            <Text style={styles.hint}>
              Shared charges are split equally. Summary shows each person’s spending and who owes you for shared charges.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    intro: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    cardName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    personBlock: { gap: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 15, fontWeight: "800", color: "#FFFFFF" },
    personName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
    link: { fontSize: 13, fontWeight: "700", color: colors.accent },
    danger: { fontSize: 13, fontWeight: "800", color: DANGER },
    cancel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.chip,
      paddingHorizontal: spacing.sm,
      paddingVertical: 9,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    smallBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: ACCENT },
    smallBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
    error: { fontSize: 12, fontWeight: "600", color: DANGER },
    hint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
    chipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    chipTextOn: { color: "#FFFFFF" },
  });
}
