import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getStatementStatuses, setStatementDayByUser, setStatementReminders, todayISO } from "../lib/db";
import { describeStatementStatus, ordinalDay, type StatementStatus } from "../lib/statementReminders";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// An account page's "where are this account's statements up to" box, with
// its reminder switch.
export function StatementStatusCard({ accountId }: { accountId: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [status, setStatus] = useState<StatementStatus | null>(null);
  const [editingDay, setEditingDay] = useState(false);
  const [dayInput, setDayInput] = useState("");

  const load = useCallback(async () => {
    const all = await getStatementStatuses(db, todayISO());
    setStatus(all.find((s) => s.accountId === accountId) ?? null);
  }, [db, accountId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!status || !status.nextExpected) return null;
  const line = describeStatementStatus(status, todayISO());

  const dayValue = Number(dayInput);
  const dayValid = dayValue >= 1 && dayValue <= 31;

  async function saveDay() {
    if (!dayValid) return;
    // Their latest transactions are from statements already uploaded, so the
    // reminder starts with the next one.
    await setStatementDayByUser(db, accountId, dayValue, true);
    setEditingDay(false);
    load();
  }

  async function toggle(on: boolean) {
    await setStatementReminders(db, accountId, on);
    load();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>📄 Statements</Text>
      {editingDay ? (
        <View style={styles.dayRow}>
          <TextInput
            value={dayInput}
            onChangeText={(v) => setDayInput(v.replace(/\D/g, "").slice(0, 2))}
            placeholder="Closing day, e.g. 15"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            autoFocus
            style={styles.dayInput}
          />
          <Pressable onPress={saveDay} style={[styles.uploadBtn, !dayValid && { opacity: 0.5 }]}>
            <Text style={styles.uploadBtnText}>Save</Text>
          </Pressable>
          <Pressable onPress={() => setEditingDay(false)}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setDayInput(status.statementDay ? String(status.statementDay) : "");
            setEditingDay(true);
          }}
        >
          <Text style={styles.meta}>
            {status.statementDay ? `Closes on the ${ordinalDay(status.statementDay)} · ` : "Closing day not set · "}
            <Text style={styles.link}>{status.statementDay ? "Change" : "Set it"}</Text>
          </Text>
        </Pressable>
      )}
      <Text style={styles.meta}>
        {status.lastStatementDate ? `Last statement closed ${formatDate(status.lastStatementDate)}` : "Based on your latest transaction"}
        {` · next one around ${formatDate(status.nextExpected)}`}
      </Text>
      {line && (
        <View style={styles.dueRow}>
          <Text style={styles.dueText}>{line}</Text>
          <Pressable
            onPress={() => router.push({ pathname: "/upload", params: { accountId: String(accountId) } })}
            style={styles.uploadBtn}
          >
            <Text style={styles.uploadBtnText}>Upload</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Remind me to upload</Text>
        <Switch
          value={status.remindersOn}
          onValueChange={toggle}
          trackColor={{ true: ACCENT, false: colors.border }}
          thumbColor="#FFFFFF"
        />
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: 6, marginBottom: spacing.md },
    title: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    meta: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    dueRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.background,
      borderRadius: radius.chip,
      padding: spacing.sm,
      marginTop: 2,
    },
    dueText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.textPrimary },
    uploadBtn: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    uploadBtnText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
    switchLabel: { fontSize: 13, color: colors.textPrimary, fontWeight: "600" },
    link: { color: colors.accent, fontWeight: "700", fontSize: 12 },
    dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dayInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.chip,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
  });
}
