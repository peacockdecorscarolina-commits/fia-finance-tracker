import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getUserName, setUserName } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const GRADIENT = ["#4C1D95", "#312E81"] as const;

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The header greeting on Home and Summary. Asks for a name on first visit
// (stored in the settings table, so it travels with Drive backups); tapping
// the greeting later lets them change it.
export function Greeting() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useFocusEffect(
    useCallback(() => {
      getUserName(db).then((stored) => {
        setName(stored);
        if (stored === null) {
          setDraft("");
          setEditing(true);
        }
      });
    }, [db])
  );

  function openEditor() {
    setDraft(name ?? "");
    setEditing(true);
  }

  // Skipping still saves (as ""), so the prompt doesn't come back on every visit.
  async function save(value: string) {
    await setUserName(db, value);
    setName(value.trim());
    setEditing(false);
  }

  return (
    <>
      <Pressable onPress={openEditor} accessibilityLabel="Change your name">
        <Text style={styles.greetingSmall}>
          {timeOfDayGreeting()}
          {name ? "," : ""}
        </Text>
        <Text style={styles.greetingName}>{name ? `${name} 👋` : "Welcome 👋"}</Text>
      </Pressable>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => save(name ?? "")}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>What should we call you?</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Your first name"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoFocus
              autoCapitalize="words"
              autoComplete="given-name"
              returnKeyType="done"
              onSubmitEditing={() => save(draft)}
              maxLength={40}
            />
            <Pressable onPress={() => save(draft)} style={styles.primaryBtnWrap}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={() => save(name ?? "")} style={styles.skipBtn}>
              <Text style={styles.skipText}>{name === null ? "Skip" : "Cancel"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    greetingSmall: { fontSize: 14, color: colors.textSecondary },
    greetingName: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
    },
    card: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      gap: spacing.sm,
    },
    title: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    input: {
      backgroundColor: colors.background,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.textPrimary,
    },
    primaryBtnWrap: { borderRadius: radius.pill, overflow: "hidden" },
    primaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 14 },
    primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    skipBtn: { alignItems: "center", paddingVertical: spacing.xs },
    skipText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  });
}
