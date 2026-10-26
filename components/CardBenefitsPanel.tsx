import { Ionicons } from "@expo/vector-icons";
import { useSQLiteContext } from "expo-sqlite";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CATALOG_CHECKED_ON, PERIOD_LABEL, type BenefitStatus } from "../lib/cardBenefits";
import { setAccountAnnualFee, setBenefitMark, type CardOverview } from "../lib/db";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const SUCCESS = "#16A34A";

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCheckedOn(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// A real card's annual fee and benefits on its account page: what's used
// this period (found on statements, or marked by the user), what's left and
// when it resets, plus whether the credits are covering the fee.
export function CardBenefitsPanel({ overview, onChanged }: { overview: CardOverview; onChanged: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const { account, card, annualFee, feeLastCharged, feeNextDue, benefits, creditsUsedLast12Months } = overview;
  const [editingFee, setEditingFee] = useState(false);
  const [feeInput, setFeeInput] = useState("");
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialInput, setPartialInput] = useState("");

  async function saveFee() {
    const value = Number(feeInput.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(value) || value < 0) return;
    await setAccountAnnualFee(db, account.id, value === card.annualFee ? null : value);
    setEditingFee(false);
    onChanged();
  }

  async function mark(status: BenefitStatus, amount: number | null) {
    await setBenefitMark(db, account.id, status.benefit.id, status.window.key, amount);
    setPartialFor(null);
    setPartialInput("");
    onChanged();
  }

  const valueVsFee = creditsUsedLast12Months - annualFee;

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>💳 Annual fee</Text>
          {!editingFee && (
            <Pressable
              onPress={() => {
                setFeeInput(String(annualFee));
                setEditingFee(true);
              }}
            >
              <Text style={styles.link}>Edit</Text>
            </Pressable>
          )}
        </View>
        {editingFee ? (
          <View style={styles.inlineRow}>
            <View style={styles.inputRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                value={feeInput}
                onChangeText={setFeeInput}
                keyboardType="decimal-pad"
                style={styles.input}
                autoFocus
              />
            </View>
            <Pressable onPress={saveFee} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Save</Text>
            </Pressable>
          </View>
        ) : annualFee === 0 ? (
          <Text style={styles.bigValue}>No annual fee</Text>
        ) : (
          <>
            <Text style={styles.bigValue}>{formatMoney(annualFee)} / year</Text>
            <Text style={styles.meta}>
              {feeLastCharged
                ? `Last charged ${formatDate(feeLastCharged)} · next ~${formatDate(feeNextDue!)}`
                : "The fee date shows once it's on an uploaded statement"}
            </Text>
            {card.benefits.length > 0 && (
              <View style={styles.valueRow}>
                <Text style={styles.meta}>Credits used, last 12 months: {formatMoney(creditsUsedLast12Months)}</Text>
                <Text style={[styles.valueText, { color: valueVsFee >= 0 ? SUCCESS : "#B45309" }]}>
                  {valueVsFee >= 0
                    ? `Covering the fee, ${formatMoney(valueVsFee)} ahead`
                    : `${formatMoney(-valueVsFee)} short of the fee`}
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      {benefits.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.title}>🎁 Benefits</Text>
          {benefits.map((s) => {
            const pct = s.benefit.amount > 0 ? (s.used / s.benefit.amount) * 100 : 0;
            const fullyUsed = s.left === 0;
            const key = `${s.benefit.id}|${s.window.key}`;
            return (
              <View key={key} style={styles.benefit}>
                <View style={styles.titleRow}>
                  <Text style={styles.benefitName}>{s.benefit.name}</Text>
                  <Text style={styles.benefitAmount}>
                    {formatMoney(s.benefit.amount)} / {PERIOD_LABEL[s.benefit.period]}
                  </Text>
                </View>
                <Text style={styles.meta}>{s.benefit.detail}</Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fullyUsed ? SUCCESS : ACCENT }]} />
                </View>
                <Text style={[styles.status, fullyUsed && { color: SUCCESS }]}>
                  {s.detectedAmount > 0 && s.detectedAmount >= (s.markedAmount ?? 0)
                    ? `✅ ${fullyUsed ? "Used" : `${formatMoney(s.used)} used`} · found on statement ${s.detectedDate ? formatDate(s.detectedDate) : ""}`
                    : s.markedAmount !== null
                      ? `✋ Marked by you: ${formatMoney(s.used)} used`
                      : s.benefit.period === "every4Years"
                        ? "Available — not used in the last 4 years"
                        : `${formatMoney(s.left)} left · ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`}
                  {!fullyUsed && s.used > 0 ? ` · ${formatMoney(s.left)} left` : ""}
                </Text>
                {partialFor === key ? (
                  <View style={styles.inlineRow}>
                    <View style={styles.inputRow}>
                      <Text style={styles.dollar}>$</Text>
                      <TextInput
                        value={partialInput}
                        onChangeText={setPartialInput}
                        keyboardType="decimal-pad"
                        placeholder={`Up to ${s.benefit.amount}`}
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                        autoFocus
                      />
                    </View>
                    <Pressable
                      onPress={() => {
                        const v = Number(partialInput.replace(/[$,\s]/g, ""));
                        if (Number.isFinite(v) && v > 0) mark(s, Math.min(v, s.benefit.amount));
                      }}
                      style={styles.smallBtn}
                    >
                      <Text style={styles.smallBtnText}>Save</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    {!fullyUsed && (
                      <Pressable onPress={() => mark(s, s.benefit.amount)} style={styles.actionBtn}>
                        <Ionicons name="checkmark-circle-outline" size={14} color={ACCENT} />
                        <Text style={styles.actionText}>I used it</Text>
                      </Pressable>
                    )}
                    {!fullyUsed && (
                      <Pressable
                        onPress={() => {
                          setPartialFor(key);
                          setPartialInput("");
                        }}
                        style={styles.actionBtn}
                      >
                        <Text style={styles.actionText}>I used part</Text>
                      </Pressable>
                    )}
                    {s.markedAmount !== null && (
                      <Pressable onPress={() => mark(s, null)} style={styles.actionBtn}>
                        <Ionicons name="arrow-undo-outline" size={14} color={colors.textSecondary} />
                        <Text style={[styles.actionText, { color: colors.textSecondary }]}>Undo</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.footnote}>
        {card.name} benefits checked {formatCheckedOn(CATALOG_CHECKED_ON)}. Issuers change terms, so confirm with
        {"your card's current benefits."}
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    title: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    link: { fontSize: 13, fontWeight: "600", color: colors.accent },
    bigValue: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
    meta: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    valueRow: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
    valueText: { fontSize: 13, fontWeight: "700" },
    benefit: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
    benefitName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    benefitAmount: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3 },
    status: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
    },
    actionText: { fontSize: 12, fontWeight: "700", color: ACCENT },
    inlineRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    inputRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
    },
    dollar: { fontSize: 14, color: colors.textSecondary, fontWeight: "600", marginRight: 4 },
    input: { flex: 1, fontSize: 14, color: colors.textPrimary },
    smallBtn: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 10 },
    smallBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
    footnote: { fontSize: 11, color: colors.textSecondary, textAlign: "center", lineHeight: 16 },
  });
}
