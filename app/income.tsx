import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getIncomeSources, setIncomeLabel, todayISO } from "../lib/db";
import { describePaySchedule, INCOME_KINDS, type IncomeKind, type IncomeSource } from "../lib/incomeSources";
import { currentMonth, periodRange, shiftMonth } from "../lib/period";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const ACCENT = "#4C1D95";
const WARNING = "#B45309";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function periodLabel(key: string): string {
  if (key.length === 4) return key;
  return new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Income for a month (or a year, "YYYY") broken down by who paid it, with
// each source's paycheck schedule, and a nickname and type to set.
export default function IncomeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ period?: string }>();
  const [period, setPeriod] = useState(params.period && /^\d{4}(-\d{2})?$/.test(params.period) ? params.period : currentMonth());
  const isYear = period.length === 4;
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [kindInput, setKindInput] = useState<IncomeKind | null>(null);

  const load = useCallback(async () => {
    const { start, end } = periodRange(period);
    setSources(await getIncomeSources(db, start, end, todayISO()));
    setLoaded(true);
  }, [db, period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const total = sources.reduce((sum, s) => sum + s.total, 0);
  const late = sources.filter((s) => s.schedule?.late);
  const thisPeriod = isYear ? period === currentMonth().slice(0, 4) : period === currentMonth();

  function step(by: number) {
    setOpenKey(null);
    setPeriod(isYear ? String(Number(period) + by) : shiftMonth(period, by));
  }

  function open(source: IncomeSource) {
    if (openKey === source.key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(source.key);
    setNameInput(source.nickname ?? "");
    setKindInput(source.kind);
  }

  async function saveLabel(source: IncomeSource) {
    await setIncomeLabel(db, source.key, nameInput, kindInput);
    setOpenKey(null);
    load();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Income</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.periodSwitch}>
          <Pressable onPress={() => step(-1)} style={styles.arrow} accessibilityLabel="Previous period">
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => setPeriod(isYear ? currentMonth() : period.slice(0, 4))}>
            <Text style={styles.periodLabel}>{periodLabel(period)}</Text>
            <Text style={styles.periodHint}>{isYear ? "Tap for months" : "Tap for the year"}</Text>
          </Pressable>
          <Pressable
            onPress={() => step(1)}
            disabled={thisPeriod}
            style={[styles.arrow, thisPeriod && { opacity: 0.3 }]}
            accessibilityLabel="Next period"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroLabel}>Income in {periodLabel(period)}</Text>
          <Text style={styles.heroValue}>{formatMoney(total)}</Text>
          <Text style={styles.heroSub}>
            {sources.filter((s) => s.total > 0).length} source{sources.filter((s) => s.total > 0).length === 1 ? "" : "s"}
          </Text>
        </LinearGradient>

        {late.map((s) => (
          <View key={`late-${s.key}`} style={styles.lateBox}>
            <Ionicons name="alert-circle" size={18} color={WARNING} />
            <Text style={styles.lateText}>
              Expected a payment from <Text style={styles.lateName}>{s.name}</Text> around {shortDate(s.schedule!.nextDate)}, not
              seen yet.
            </Text>
          </View>
        ))}

        {loaded && sources.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No income here yet</Text>
            <Text style={styles.meta}>
              Deposits count as income once they're in the Income category (or one set to count as income). Mark a paycheck
              once and Fia remembers that payer.
            </Text>
          </View>
        )}

        {sources.map((s) => {
          const kind = INCOME_KINDS.find((k) => k.value === s.kind);
          const share = total > 0 ? (s.total / total) * 100 : 0;
          const isOpen = openKey === s.key;
          return (
            <View key={s.key} style={styles.card}>
              <Pressable onPress={() => open(s)} style={{ gap: 6 }}>
                <View style={styles.sourceRow}>
                  <Text style={styles.sourceEmoji}>{kind?.emoji ?? "💵"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sourceName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {[kind?.label, s.accountName].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Text style={styles.sourceAmount}>{formatMoney(s.total)}</Text>
                </View>
                {total > 0 && (
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${share}%` }]} />
                  </View>
                )}
                {s.schedule && (
                  <Text style={[styles.meta, s.schedule.late && { color: WARNING, fontWeight: "700" }]}>
                    {describePaySchedule(s.schedule)} · {s.schedule.late ? "was due" : "next around"} {shortDate(s.schedule.nextDate)}
                  </Text>
                )}
              </Pressable>

              {isOpen && (
                <View style={styles.editBox}>
                  <Text style={styles.fieldLabel}>Nickname</Text>
                  <TextInput
                    value={nameInput}
                    onChangeText={setNameInput}
                    placeholder="e.g. Main job"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                  />
                  <Text style={styles.fieldLabel}>Type</Text>
                  <View style={styles.chipRow}>
                    {INCOME_KINDS.map((k) => {
                      const active = kindInput === k.value;
                      return (
                        <Pressable
                          key={k.value}
                          onPress={() => setKindInput(active ? null : k.value)}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {k.emoji} {k.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable onPress={() => saveLabel(s)} style={styles.saveBtn}>
                    <Text style={styles.saveText}>Save</Text>
                  </Pressable>
                  {s.deposits.length > 0 && <Text style={styles.fieldLabel}>Deposits</Text>}
                  {s.deposits.map((t) => (
                    <View key={t.id} style={styles.depositRow}>
                      <Text style={styles.meta}>
                        {shortDate(t.date)} · {t.accountName}
                      </Text>
                      <Text style={styles.depositAmount}>{formatMoney(t.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Pressable onPress={() => router.push("/categories")} style={styles.footerLink}>
          <Ionicons name="pricetag-outline" size={14} color={colors.accent} />
          <Text style={styles.footerText}>Count another category as income (Salary, Rental...)</Text>
        </Pressable>
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
    headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    periodSwitch: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.sm,
    },
    arrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    periodLabel: { fontSize: 16, fontWeight: "800", color: colors.textPrimary, textAlign: "center" },
    periodHint: { fontSize: 11, color: colors.textSecondary, textAlign: "center", marginTop: 1 },
    hero: { borderRadius: radius.card, padding: spacing.md, gap: 4 },
    heroLabel: { fontSize: 13, color: "#FFFFFFCC", fontWeight: "600" },
    heroValue: { fontSize: 28, fontWeight: "800", color: "#FFFFFF" },
    heroSub: { fontSize: 13, color: "#FFFFFFCC" },
    lateBox: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
      padding: spacing.md,
      borderRadius: radius.card,
      borderWidth: 1.5,
      borderColor: "#FDE68A",
      backgroundColor: colors.card,
    },
    lateText: { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
    lateName: { fontWeight: "700" },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    sourceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    sourceEmoji: { fontSize: 22 },
    sourceName: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    sourceAmount: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
    meta: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
    barFill: { height: 6, borderRadius: 3, backgroundColor: "#16A34A" },
    editBox: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    fieldLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
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
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
    chipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    chipTextActive: { color: "#FFFFFF" },
    saveBtn: { alignSelf: "flex-start", backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 8 },
    saveText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
    depositRow: { flexDirection: "row", justifyContent: "space-between" },
    depositAmount: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
    footerLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: spacing.xs },
    footerText: { fontSize: 13, fontWeight: "600", color: colors.accent },
  });
}
