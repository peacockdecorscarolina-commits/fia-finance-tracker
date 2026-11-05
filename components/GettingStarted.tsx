import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getSetting, setSetting } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const SUCCESS = "#16A34A";
const HIDDEN_KEY = "getting_started_hidden";
// Set by the first manual backup or restore (see autoBackup.ts).
const LAST_SYNC_KEY = "last_drive_sync_at";

type Step = { done: boolean; title: string; text: string; action: string; go: () => void };

// Home's first-time guide: four steps that tick themselves off as they're
// done. Gone once all are done, or hidden.
export function GettingStarted() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [steps, setSteps] = useState<Step[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if ((await getSetting(db, HIDDEN_KEY)) !== null) {
          setSteps(null);
          return;
        }
        const row = await db.getFirstAsync<{ accounts: number; transactions: number; review: number }>(
          `SELECT (SELECT COUNT(*) FROM accounts) as accounts,
             (SELECT COUNT(*) FROM transactions) as transactions,
             (SELECT COUNT(*) FROM transactions WHERE needs_review = 1 AND ignored = 0) as review`
        );
        const backedUp = (await getSetting(db, LAST_SYNC_KEY)) !== null;
        const accounts = row?.accounts ?? 0;
        const transactions = row?.transactions ?? 0;
        setSteps([
          {
            done: accounts > 0,
            title: "Add your cards and bank accounts",
            text: "Pick your card from the list to get its benefits and annual fee.",
            action: "Add",
            go: () => router.push("/accounts"),
          },
          {
            done: transactions > 0,
            title: "Upload a statement",
            text: "A PDF statement, or the CSV from your bank's \"Download transactions\".",
            action: "Upload",
            go: () => router.push("/upload"),
          },
          {
            done: transactions > 0 && (row?.review ?? 0) === 0,
            title: "Sort new transactions",
            text: "Tap a category once per store. Fia remembers it from then on.",
            action: "Review",
            go: () => router.push("/review"),
          },
          {
            done: backedUp,
            title: "Back up to Google Drive",
            text: "Keeps a copy in your own Drive. After this, Fia backs up on its own.",
            action: "Back up",
            go: () => router.push("/sync"),
          },
        ]);
      })();
    }, [db])
  );

  if (!steps || steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  async function hide() {
    await setSetting(db, HIDDEN_KEY, "1");
    setSteps(null);
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Getting started</Text>
        <Text style={styles.count}>
          {doneCount} of {steps.length}
        </Text>
        <Pressable onPress={hide} hitSlop={8} accessibilityLabel="Hide getting started">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(doneCount / steps.length) * 100}%` }]} />
      </View>
      {steps.map((s, i) => (
        <View key={s.title} style={styles.step}>
          <Ionicons
            name={s.done ? "checkmark-circle" : "ellipse-outline"}
            size={20}
            color={s.done ? SUCCESS : i === next ? ACCENT : colors.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.stepTitle, s.done && styles.stepDone]}>{s.title}</Text>
            {i === next && <Text style={styles.stepText}>{s.text}</Text>}
          </View>
          {i === next && (
            <Pressable onPress={s.go} style={styles.action}>
              <Text style={styles.actionText}>{s.action}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
    titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    title: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.textPrimary },
    count: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3, backgroundColor: ACCENT },
    step: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
    stepTitle: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    stepDone: { color: colors.textSecondary, textDecorationLine: "line-through" },
    stepText: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginTop: 1 },
    action: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
    actionText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  });
}
