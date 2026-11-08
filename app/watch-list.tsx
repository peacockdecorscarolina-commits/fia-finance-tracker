import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { TransactionRow } from "../components/TransactionRow";
import {
  addWatch,
  deleteWatch,
  getFlaggedTransactions,
  getWatches,
  getWatchFinds,
  reopenWatch,
  type WatchWithFinds,
} from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Transaction } from "../lib/types";
import { describeWatch, type WatchDirection } from "../lib/watches";

const ACCENT = "#4C1D95";
const DANGER = "#DC2626";
const DONE_SHOWN = 10;

const DIRECTIONS: { value: WatchDirection | null; label: string }[] = [
  { value: null, label: "Either" },
  { value: "in", label: "Money in" },
  { value: "out", label: "A charge" },
];

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Notes about transactions the user is waiting for -- a refund, a deposit,
// a charge they want to catch. Each statement uploaded afterward is checked,
// and a match is flagged with the note.
export default function WatchListScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ lookFor?: string; amount?: string; direction?: string; note?: string }>();
  const [watches, setWatches] = useState<WatchWithFinds[]>([]);
  const [flagged, setFlagged] = useState<Transaction[]>([]);
  const [finds, setFinds] = useState<Map<number, Transaction[]>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lookFor, setLookFor] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<WatchDirection | null>(null);
  const [keepWatching, setKeepWatching] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, flags] = await Promise.all([getWatches(db), getFlaggedTransactions(db)]);
    const done = list.filter((w) => w.closedAt).slice(0, DONE_SHOWN);
    const found = new Map<number, Transaction[]>();
    for (const w of [...done, ...list.filter((w) => !w.closedAt && w.confirmed > 0)]) {
      found.set(w.id, await getWatchFinds(db, w.id));
    }
    setWatches(list);
    setFlagged(flags);
    setFinds(found);
    setLoaded(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Opened from a transaction's "Watch" button: the form, filled in. Once
  // per arrival -- the params are cleared so coming back doesn't refill it.
  useEffect(() => {
    if (!params.lookFor) return;
    setLookFor(params.lookFor);
    setNote(params.note ?? "");
    setAmount(params.amount ?? "");
    setDirection(params.direction === "in" || params.direction === "out" ? params.direction : null);
    setKeepWatching(false);
    setAdding(true);
    router.setParams({ lookFor: undefined, amount: undefined, direction: undefined, note: undefined });
  }, [params.lookFor, params.note, params.amount, params.direction]);

  function openForm() {
    setLookFor("");
    setNote("");
    setAmount("");
    setDirection(null);
    setKeepWatching(false);
    setJustAdded(null);
    setAdding(true);
  }

  const amountValue = amount.trim() ? Number(amount.replace(/[$,]/g, "")) : null;
  const amountOk = amountValue === null || (Number.isFinite(amountValue) && amountValue > 0);
  const canSave = lookFor.trim().length > 0 && amountOk;

  async function save() {
    if (!canSave) return;
    await addWatch(db, { lookFor, note, amount: amountValue, direction, keepWatching });
    setJustAdded(lookFor.trim());
    setAdding(false);
    load();
  }

  const open = watches.filter((w) => !w.closedAt);
  const done = watches.filter((w) => w.closedAt).slice(0, DONE_SHOWN);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Watch list</Text>
          <View style={styles.headerBtn} />
        </View>

        {flagged.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.sectionTitle}>
              👀 Found {flagged.length} · is {flagged.length === 1 ? "this" : "each"} the one?
            </Text>
            {flagged.map((t) => (
              <TransactionRow key={t.id} transaction={t} onWatchAnswered={load} />
            ))}
          </View>
        )}

        {adding ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Watch for a transaction</Text>
            <Text style={styles.fieldLabel}>Look for</Text>
            <TextInput
              value={lookFor}
              onChangeText={setLookFor}
              placeholder="A name on the statement, e.g. Amazon"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoFocus={!lookFor}
            />
            <Text style={styles.fieldLabel}>Note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Refund for the returned shoes"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, styles.multiline]}
              multiline
            />
            <Text style={styles.fieldLabel}>Amount (optional)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="About how much, e.g. 45"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, !amountOk && { borderColor: DANGER }]}
            />
            <Text style={styles.fieldLabel}>Is it</Text>
            <View style={styles.chipRow}>
              {DIRECTIONS.map((d) => (
                <Pressable
                  key={d.label}
                  onPress={() => setDirection(d.value)}
                  style={[styles.chip, direction === d.value && styles.chipActive]}
                >
                  <Text style={[styles.chipText, direction === d.value && styles.chipTextActive]}>{d.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Keep watching</Text>
                <Text style={styles.hint}>Flag it every time, not just once. For things like every gym charge.</Text>
              </View>
              <Switch
                value={keepWatching}
                onValueChange={setKeepWatching}
                trackColor={{ true: ACCENT, false: colors.border }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Text style={styles.hint}>
              Fia checks every statement you upload from now on and flags a match with your note.
            </Text>
            <View style={styles.formActions}>
              <Pressable onPress={() => setAdding(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={!canSave} style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}>
                <Text style={styles.saveText}>Start watching</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={openForm} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.addText}>Add a watch</Text>
          </Pressable>
        )}

        {justAdded && !adding && (
          <Text style={styles.added}>
            ✓ Watching for {justAdded}. {"You'll"} see it flagged when a statement with it is uploaded.
          </Text>
        )}

        {loaded && open.length === 0 && done.length === 0 && !adding && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Waiting on a transaction?</Text>
            <Text style={styles.hint}>
              A refund, money a friend owes you, a deposit coming back... Add a note here, and when you upload a
              statement that has it, Fia flags the transaction with your note.
            </Text>
            <Text style={styles.hint}>
              You can also tap {"\"Watch for refund\""} on any transaction to fill this in for you.
            </Text>
          </View>
        )}

        {open.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Watching</Text>
            {open.map((w) => (
              <View key={w.id} style={styles.watchRow}>
                <Ionicons name="eye-outline" size={18} color={ACCENT} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.watchName}>{w.lookFor}</Text>
                  {!!w.note && <Text style={styles.watchNote}>{w.note}</Text>}
                  <Text style={styles.meta}>
                    {[describeWatch(w), `since ${shortDate(w.createdAt)}`].filter(Boolean).join(" · ")}
                    {w.flagged > 0 ? ` · ${w.flagged} to check` : ""}
                    {w.confirmed > 0 ? ` · found ${w.confirmed}` : ""}
                  </Text>
                  <FoundList list={finds.get(w.id)} styles={styles} />
                </View>
                <DeleteButton
                  confirming={confirmingDelete === w.id}
                  onPress={async () => {
                    if (confirmingDelete !== w.id) return setConfirmingDelete(w.id);
                    await deleteWatch(db, w.id);
                    setConfirmingDelete(null);
                    load();
                  }}
                  styles={styles}
                />
              </View>
            ))}
          </View>
        )}

        {done.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Found</Text>
            {done.map((w) => (
              <View key={w.id} style={styles.watchRow}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.watchName}>{w.lookFor}</Text>
                  {!!w.note && <Text style={styles.watchNote}>{w.note}</Text>}
                  <FoundList list={finds.get(w.id)} styles={styles} />
                  <Pressable
                    onPress={async () => {
                      await reopenWatch(db, w.id);
                      load();
                    }}
                  >
                    <Text style={styles.link}>Watch again</Text>
                  </Pressable>
                </View>
                <DeleteButton
                  confirming={confirmingDelete === w.id}
                  onPress={async () => {
                    if (confirmingDelete !== w.id) return setConfirmingDelete(w.id);
                    await deleteWatch(db, w.id);
                    setConfirmingDelete(null);
                    load();
                  }}
                  styles={styles}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FoundList({ list, styles }: { list: Transaction[] | undefined; styles: Styles }) {
  if (!list?.length) return null;
  return (
    <>
      {list.slice(0, 3).map((t) => (
        <Text key={t.id} style={styles.found}>
          ✓ {formatMerchantName(t.merchant)} · {t.amount > 0 ? "+" : "-"}${Math.abs(t.amount).toFixed(2)} on{" "}
          {shortDate(t.date)} ({t.accountName})
        </Text>
      ))}
    </>
  );
}

function DeleteButton({ confirming, onPress, styles }: { confirming: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.deleteBtn}>
      {confirming ? (
        <Text style={styles.deleteText}>Delete?</Text>
      ) : (
        <Ionicons name="trash-outline" size={16} color={DANGER} />
      )}
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
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
    multiline: { minHeight: 60, textAlignVertical: "top" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
    chipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    chipTextActive: { color: "#FFFFFF" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    switchTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    hint: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    formActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    cancelText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
    saveBtn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: radius.pill, backgroundColor: ACCENT },
    saveText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 13,
      borderRadius: radius.pill,
      backgroundColor: ACCENT,
    },
    addText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
    added: { fontSize: 13, color: "#16A34A", fontWeight: "600", textAlign: "center" },
    watchRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 6 },
    watchName: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    watchNote: { fontSize: 13, color: colors.textPrimary, fontStyle: "italic", lineHeight: 18 },
    meta: { fontSize: 12, color: colors.textSecondary },
    found: { fontSize: 12, color: "#16A34A", fontWeight: "600" },
    link: { fontSize: 12, fontWeight: "700", color: colors.accent, marginTop: 2 },
    deleteBtn: { paddingHorizontal: 4, paddingVertical: 2 },
    deleteText: { fontSize: 12, fontWeight: "800", color: DANGER },
  });
}
