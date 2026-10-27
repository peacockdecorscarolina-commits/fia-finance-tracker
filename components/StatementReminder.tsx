import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getStatementSnoozes, getStatementStatuses, skipStatementMonth, snoozeStatementReminder, todayISO } from "../lib/db";
import { addDays, describeStatementStatus, monthName, monthToSkip, type StatementStatus } from "../lib/statementReminders";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const SNOOZE_DAYS = 3;
const MAX_ROWS = 3;

// Home's nudge for statements that are out but not uploaded yet, or months
// that were skipped -- either way, totals for that account are short.
export function StatementReminder() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [due, setDue] = useState<{ status: StatementStatus; line: string }[]>([]);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const today = todayISO();
    const [statuses, snoozes] = await Promise.all([getStatementStatuses(db, today), getStatementSnoozes(db)]);
    setDue(
      statuses
        .filter((s) => !(snoozes[s.accountId] && snoozes[s.accountId] > today))
        .map((s) => ({ status: s, line: describeStatementStatus(s, today) }))
        .filter((d): d is { status: StatementStatus; line: string } => d.line !== null)
    );
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (due.length === 0) return null;
  const rows = showAll ? due : due.slice(0, MAX_ROWS);

  async function noStatement(s: StatementStatus) {
    const month = monthToSkip(s);
    if (month) await skipStatementMonth(db, s.accountId, month);
    load();
  }

  async function later(s: StatementStatus) {
    await snoozeStatementReminder(db, s.accountId, addDays(todayISO(), SNOOZE_DAYS));
    load();
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.icon}>
          <Ionicons name="document-text-outline" size={18} color={ACCENT} />
        </View>
        <Text style={styles.title}>
          {due.length === 1 ? "A statement to upload" : `${due.length} accounts need a statement`}
        </Text>
      </View>
      {rows.map(({ status, line }) => {
        const skipMonth = monthToSkip(status);
        return (
          <View key={status.accountId} style={styles.row}>
            <Text style={styles.accountName} numberOfLines={1}>
              {status.accountName}
            </Text>
            <Text style={styles.text}>{line}</Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => router.push({ pathname: "/upload", params: { accountId: String(status.accountId) } })}
                style={styles.uploadBtn}
              >
                <Ionicons name="cloud-upload-outline" size={13} color="#FFFFFF" />
                <Text style={styles.uploadBtnText}>Upload</Text>
              </Pressable>
              {skipMonth && (
                <Pressable onPress={() => noStatement(status)} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>No {monthName(skipMonth)} statement</Text>
                </Pressable>
              )}
              <Pressable onPress={() => later(status)} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Later</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {due.length > MAX_ROWS && (
        <Pressable onPress={() => setShowAll((v) => !v)}>
          <Text style={styles.more}>{showAll ? "Show less" : `+${due.length - MAX_ROWS} more`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1.5,
      borderColor: "#DDD6FE",
      padding: spacing.md,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#EDE9FE",
      alignItems: "center",
      justifyContent: "center",
    },
    title: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    row: { gap: 2, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    accountName: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    uploadBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: ACCENT,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    uploadBtnText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
    secondaryBtn: {
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.background,
    },
    secondaryBtnText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    more: { fontSize: 13, fontWeight: "600", color: colors.accent, textAlign: "center", paddingTop: 2 },
  });
}
