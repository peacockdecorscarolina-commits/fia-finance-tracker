import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  appInfo,
  BANK_PROBLEMS,
  FEEDBACK_TYPES,
  feedbackProblem,
  getFeedbackHistory,
  getStatementForFeedback,
  hideAccountNumbers,
  MESSAGE_MAX,
  sendFeedback,
  sendWaitingFeedback,
  STATEMENT_MAX,
  type FeedbackHistoryItem,
  type FeedbackPayload,
  type FeedbackType,
} from "../lib/feedback";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;
const ACCENT = "#4C1D95";
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";
const SUCCESS = "#16A34A";

const MESSAGE_PLACEHOLDER: Record<FeedbackType, string> = {
  suggestion: "What would you like Fia to do?",
  problem: "What went wrong, and what were you doing when it happened?",
  card: "Anything else about it? (optional)",
  bank: "Anything else? (optional)",
};

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string } | { kind: "done"; waiting: boolean };

export default function FeedbackScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ type?: string; card?: string; bank?: string; from?: string; statement?: string }>();
  const startType = FEEDBACK_TYPES.some((t) => t.value === params.type) ? (params.type as FeedbackType) : "suggestion";

  const [type, setType] = useState<FeedbackType>(startType);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [cardName, setCardName] = useState(params.card ?? "");
  const [issuer, setIssuer] = useState("");
  const [link, setLink] = useState("");
  const [bankName, setBankName] = useState(params.bank ?? "");
  const [bankProblem, setBankProblem] = useState(startType === "bank" && params.statement === "1" ? BANK_PROBLEMS[0] : "");
  const [includeStatement, setIncludeStatement] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [history, setHistory] = useState<FeedbackHistoryItem[]>([]);

  const statementText = params.statement === "1" ? getStatementForFeedback() : "";
  const screen = params.from ?? "Menu";

  const loadHistory = useCallback(async () => {
    await sendWaitingFeedback(db);
    setHistory(await getFeedbackHistory(db));
  }, [db]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function buildPayload(): FeedbackPayload {
    return {
      type,
      message,
      email,
      cardName: type === "card" || type === "problem" ? cardName : "",
      issuer: type === "card" ? issuer : "",
      link: type === "card" ? link : "",
      bankName: type === "bank" ? bankName : "",
      bankProblem: type === "bank" ? bankProblem : "",
      statementText:
        type === "bank" && includeStatement ? hideAccountNumbers(statementText).slice(0, STATEMENT_MAX) : "",
      screen,
      ...appInfo(),
    };
  }

  async function handleSend() {
    const payload = buildPayload();
    const problem = feedbackProblem(payload);
    if (problem) {
      setStatus({ kind: "error", message: problem });
      return;
    }
    setStatus({ kind: "busy" });
    try {
      const result = await sendFeedback(db, payload);
      setStatus({ kind: "done", waiting: result === "waiting" });
      setMessage("");
      setCardName("");
      setIssuer("");
      setLink("");
      setIncludeStatement(false);
      setHistory(await getFeedbackHistory(db));
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Couldn't send it." });
    }
  }

  function chooseType(next: FeedbackType) {
    setType(next);
    if (status.kind !== "busy") setStatus({ kind: "idle" });
  }

  const busy = status.kind === "busy";
  const typeLabel = (t: FeedbackType) => FEEDBACK_TYPES.find((f) => f.value === t)!;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Send feedback</Text>
          <View style={styles.headerBtn} />
        </View>

        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.heroText}>
            Tell us what to add, what broke, or which card or bank Fia should support. Every message is read.
          </Text>
        </LinearGradient>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>What is it about?</Text>
          <View style={styles.typeGrid}>
            {FEEDBACK_TYPES.map((t) => {
              const active = type === t.value;
              return (
                <Pressable key={t.value} onPress={() => chooseType(t.value)} style={[styles.typeTile, active && styles.typeTileActive]}>
                  <Text style={styles.typeEmoji}>{t.emoji}</Text>
                  <Text style={[styles.typeTileText, active && styles.typeTileTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          {type === "card" && (
            <>
              <Text style={styles.fieldLabel}>Card name</Text>
              <TextInput
                value={cardName}
                onChangeText={setCardName}
                placeholder="e.g. Delta SkyMiles Gold"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Bank or issuer</Text>
              <TextInput
                value={issuer}
                onChangeText={setIssuer}
                placeholder="e.g. American Express"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Link to the card's page (optional)</Text>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder="https://"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                style={styles.input}
              />
            </>
          )}

          {type === "bank" && (
            <>
              <Text style={styles.fieldLabel}>Which bank is the statement from?</Text>
              <TextInput
                value={bankName}
                onChangeText={setBankName}
                placeholder="e.g. Wells Fargo"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>What went wrong?</Text>
              <View style={styles.chipRow}>
                {BANK_PROBLEMS.map((p) => {
                  const active = bankProblem === p;
                  return (
                    <Pressable key={p} onPress={() => setBankProblem(p)} style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {type === "problem" && cardName !== "" && (
            <View style={styles.aboutRow}>
              <Ionicons name="card-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.aboutText}>About: {cardName}</Text>
              <Pressable onPress={() => setCardName("")}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}

          <Text style={styles.fieldLabel}>{type === "suggestion" || type === "problem" ? "Message" : "Details"}</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={MESSAGE_PLACEHOLDER[type]}
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={MESSAGE_MAX}
            style={[styles.input, styles.messageInput]}
          />

          <Text style={styles.fieldLabel}>Your email (only if you'd like a reply)</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />

          {type === "bank" && statementText !== "" && (
            <Pressable onPress={() => setIncludeStatement((v) => !v)} style={styles.checkRow}>
              <Ionicons
                name={includeStatement ? "checkbox" : "square-outline"}
                size={20}
                color={includeStatement ? ACCENT : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkTitle}>Include this statement's text to help fix it</Text>
                <Text style={styles.checkText}>
                  It contains your transactions, amounts and possibly your name and address. Card and account numbers
                  are hidden except the last 4 digits. Only send it if you're comfortable with that.
                </Text>
              </View>
            </Pressable>
          )}

          <View style={styles.sentInfo}>
            <Ionicons name="lock-closed-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.sentInfoText}>
              {"Sent with it: the screen you came from, Fia's version and your browser. "}
              {includeStatement && type === "bank"
                ? "Plus the statement's text, because you ticked the box."
                : "Never your transactions or balances."}
            </Text>
          </View>

          {status.kind === "error" && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{status.message}</Text>
            </View>
          )}
          {status.kind === "done" && (
            <View style={styles.doneBox}>
              <Text style={styles.doneText}>
                {status.waiting
                  ? "You're offline. It's saved and will be sent the next time Fia is online."
                  : "Thanks, we got it!"}
              </Text>
            </View>
          )}

          <Pressable onPress={handleSend} disabled={busy} style={[styles.primaryBtnWrap, busy && { opacity: 0.5 }]}>
            <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
              <Ionicons name="paper-plane-outline" size={16} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>{busy ? "Sending..." : "Send"}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {history.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Your messages</Text>
            {history.map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <Text style={styles.typeEmoji}>{typeLabel(h.type).emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historySummary} numberOfLines={1}>
                    {h.summary || typeLabel(h.type).label}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {typeLabel(h.type).label} · {new Date(h.sentAt).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={[styles.historyStatus, { color: h.status === "sent" ? SUCCESS : "#B45309" }]}>
                  {h.status === "sent" ? "Sent" : "Waiting to send"}
                </Text>
              </View>
            ))}
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
  hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: { fontSize: 13, color: "#FFFFFFE6", lineHeight: 19 },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeTile: {
    flexBasis: "47%",
    flexGrow: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  typeTileActive: { borderColor: colors.accent, backgroundColor: colors.background },
  typeEmoji: { fontSize: 20 },
  typeTileText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  typeTileTextActive: { color: colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textPrimary, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  messageInput: { minHeight: 110, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  aboutText: { fontSize: 13, color: colors.textPrimary, fontWeight: "600" },
  checkRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.chip,
    backgroundColor: colors.background,
    marginTop: spacing.xs,
  },
  checkTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  checkText: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginTop: 2 },
  sentInfo: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: spacing.xs },
  sentInfoText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  primaryBtnWrap: { borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.xs },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  errorBox: { backgroundColor: DANGER_LIGHT, borderRadius: radius.chip, padding: spacing.sm },
  errorText: { fontSize: 13, color: DANGER, fontWeight: "600" },
  doneBox: { backgroundColor: "#F0FDF4", borderRadius: radius.chip, padding: spacing.sm },
  doneText: { fontSize: 13, color: SUCCESS, fontWeight: "600" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  historySummary: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  historyMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  historyStatus: { fontSize: 12, fontWeight: "700" },
  });
}
