import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getCategoryStyle } from "../lib/categoryStyle";
import {
  getAllTags,
  getRecurringOverride,
  normalizeTag,
  setRecurringOverride,
  setTransactionNote,
  setTransactionReimbursed,
} from "../lib/db";
import type { RecurringOverride } from "../lib/subscriptions";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Category, Transaction } from "../lib/types";
import { AmountText } from "./AmountText";
import { Chip } from "./Chip";

// Matches the rest of the app's redesigned screens -- theme-invariant.
const DANGER = "#DC2626";
const DANGER_LIGHT = "#FEE2E2";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TransactionRow({
  transaction,
  onToggleIgnored,
  categories,
  onChangeCategory,
  onDelete,
  onFindTransferCandidates,
  onLinkTransfer,
  onUnlinkTransfer,
}: {
  transaction: Transaction;
  onToggleIgnored?: (transaction: Transaction) => void;
  categories?: Category[];
  onChangeCategory?: (transaction: Transaction, categoryId: number) => void;
  onDelete?: (transaction: Transaction) => void;
  onFindTransferCandidates?: (transaction: Transaction) => Promise<Transaction[]>;
  onLinkTransfer?: (transaction: Transaction, candidateId: number) => void;
  onUnlinkTransfer?: (transaction: Transaction) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickingLink, setPickingLink] = useState(false);
  const [linkCandidates, setLinkCandidates] = useState<Transaction[] | null>(null);
  const categoryStyle = getCategoryStyle(transaction.categoryName);

  // Notes and tags save straight from the row, so every list that shows
  // transactions gets them without its own handler. Local copies show the
  // saved values right away; they resync whenever the parent reloads.
  const db = useSQLiteContext();
  const [note, setNote] = useState(transaction.note);
  const [tags, setTags] = useState(transaction.tags);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const tagsKey = transaction.tags.join(",");
  useEffect(() => {
    setNote(transaction.note);
    setTags(transaction.tags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.note, tagsKey]);

  function openNoteEditor() {
    if (editingNote) {
      setEditingNote(false);
      return;
    }
    setNoteDraft(note ?? "");
    setTagsDraft(tags);
    setTagInput("");
    setEditingNote(true);
    getAllTags(db).then((all) => setKnownTags(all.map((t) => t.name)));
  }

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    if (tag && !tagsDraft.includes(tag)) setTagsDraft([...tagsDraft, tag]);
    setTagInput("");
  }

  // Typing a space or comma finishes a tag, like most tag fields.
  function handleTagInput(text: string) {
    if (/[\s,]$/.test(text)) addTag(text);
    else setTagInput(text);
  }

  async function saveNote() {
    // A half-typed tag still counts when they hit Save.
    const finalTags = tagInput.trim() ? [...tagsDraft, normalizeTag(tagInput)].filter(Boolean) : tagsDraft;
    await setTransactionNote(db, transaction.id, noteDraft, finalTags);
    setNote(noteDraft.trim() || null);
    setTags([...new Set(finalTags)].sort());
    setEditingNote(false);
  }

  // The user's call on whether this merchant is a subscription, loaded when
  // the panel opens rather than for every row in a long list.
  const [pickingRecurring, setPickingRecurring] = useState(false);
  const [recurringChoice, setRecurringChoice] = useState<RecurringOverride | null>(null);

  async function toggleRecurringPanel() {
    if (pickingRecurring) {
      setPickingRecurring(false);
      return;
    }
    setRecurringChoice(await getRecurringOverride(db, transaction.merchant));
    setPickingRecurring(true);
  }

  async function chooseRecurring(choice: RecurringOverride | null) {
    await setRecurringOverride(db, transaction.merchant, choice);
    setRecurringChoice(choice);
    setPickingRecurring(false);
  }

  // "Someone paid me back": part of a charge covered by cash, Zelle and so
  // on. Spending and what's owed on a card then count only the rest.
  const [reimbursed, setReimbursed] = useState(transaction.reimbursed);
  const [reimbursedVia, setReimbursedVia] = useState(transaction.reimbursedVia);
  const [editingPaidBack, setEditingPaidBack] = useState(false);
  const [paidBackInput, setPaidBackInput] = useState("");
  const [paidBackVia, setPaidBackVia] = useState("Zelle");
  useEffect(() => {
    setReimbursed(transaction.reimbursed);
    setReimbursedVia(transaction.reimbursedVia);
  }, [transaction.reimbursed, transaction.reimbursedVia]);
  const charge = Math.abs(transaction.amount);
  const isCharge = transaction.amount < 0;

  function togglePaidBack() {
    if (editingPaidBack) {
      setEditingPaidBack(false);
      return;
    }
    setPaidBackInput(reimbursed ? String(reimbursed) : "");
    setPaidBackVia(reimbursedVia ?? "Zelle");
    setEditingPaidBack(true);
  }

  async function savePaidBack(amount: number | null) {
    const value = amount === null ? null : Math.min(Math.max(amount, 0), charge);
    await setTransactionReimbursed(db, transaction.id, value, paidBackVia);
    setReimbursed(value && value > 0 ? value : null);
    setReimbursedVia(value && value > 0 ? paidBackVia : null);
    setEditingPaidBack(false);
  }

  const typed = normalizeTag(tagInput);
  const suggestions = knownTags
    .filter((t) => !tagsDraft.includes(t) && (!typed || t.startsWith(typed)))
    .slice(0, 8);

  async function togglePickingLink() {
    if (pickingLink) {
      setPickingLink(false);
      return;
    }
    setPickingLink(true);
    setLinkCandidates(null);
    const candidates = (await onFindTransferCandidates?.(transaction)) ?? [];
    setLinkCandidates(candidates);
  }

  return (
    <View style={[styles.card, transaction.ignored && styles.ignoredCard]}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: hexToRgba(categoryStyle.color, 0.14) }]}>
          <Text style={styles.avatarEmoji}>{categoryStyle.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant} numberOfLines={2}>
            {formatMerchantName(transaction.merchant)}
          </Text>
          <Text style={styles.meta}>
            {transaction.date} · {transaction.accountName}
          </Text>
          <View style={styles.chipRow}>
            <View style={[styles.categoryChip, { backgroundColor: hexToRgba(categoryStyle.color, 0.12) }]}>
              <Text style={styles.categoryChipEmoji}>{categoryStyle.emoji}</Text>
              <Text style={[styles.categoryChipLabel, { color: categoryStyle.color }]}>
                {transaction.categoryName}
              </Text>
            </View>
            {transaction.needsReview && <Chip label="review" tone="warning" />}
            {transaction.ignored && <Chip label="ignored" />}
            {transaction.linkedTransactionId && <Chip label="transfer" tone="warning" />}
            {tags.map((tag) => (
              <Pressable
                key={tag}
                onPress={() => router.push({ pathname: "/all-transactions", params: { search: "1", tag } })}
                style={styles.tagChip}
                accessibilityLabel={`Show all transactions tagged ${tag}`}
              >
                <Text style={styles.tagChipText}>#{tag}</Text>
              </Pressable>
            ))}
          </View>
          {note ? <Text style={styles.noteText}>{note}</Text> : null}
          {reimbursed ? (
            <Text style={styles.paidBackText}>
              Paid back ${reimbursed.toFixed(2)}
              {reimbursedVia ? ` by ${reimbursedVia}` : ""} · your share ${(charge - reimbursed).toFixed(2)}
            </Text>
          ) : null}
        </View>
        <AmountText amount={transaction.amount} />
      </View>

      {transaction.linkedTransactionId && (
        <Pressable onPress={() => onUnlinkTransfer?.(transaction)} style={styles.linkedRow}>
          <Ionicons name="swap-horizontal" size={13} color={colors.accent} />
          <Text style={styles.linkedText} numberOfLines={1}>
            Linked to {formatMerchantName(transaction.linkedMerchant ?? "")} ({transaction.linkedAccountName}) on{" "}
            {transaction.linkedDate} — tap to unlink
          </Text>
        </Pressable>
      )}

      <View style={styles.actionsRow}>
        {categories && onChangeCategory && (
          <Pressable onPress={() => setPickingCategory((v) => !v)} style={styles.actionBtn}>
            <Ionicons name="pricetag-outline" size={13} color={colors.accent} />
            <Text style={styles.actionLinkText}>{pickingCategory ? "Cancel" : "Category"}</Text>
          </Pressable>
        )}
        <Pressable onPress={openNoteEditor} style={styles.actionBtn}>
          <Ionicons name="create-outline" size={13} color={colors.accent} />
          <Text style={styles.actionLinkText}>{editingNote ? "Cancel" : note || tags.length ? "Edit note" : "Note"}</Text>
        </Pressable>
        {isCharge && (
          <Pressable onPress={togglePaidBack} style={styles.actionBtn}>
            <Ionicons name="people-outline" size={13} color={colors.accent} />
            <Text style={styles.actionLinkText}>{editingPaidBack ? "Cancel" : "Paid back"}</Text>
          </Pressable>
        )}
        <Pressable onPress={toggleRecurringPanel} style={styles.actionBtn}>
          <Ionicons name="repeat" size={13} color={colors.accent} />
          <Text style={styles.actionLinkText}>{pickingRecurring ? "Cancel" : "Subscription"}</Text>
        </Pressable>
        {onToggleIgnored && (
          <Pressable onPress={() => onToggleIgnored(transaction)} style={styles.actionBtn}>
            <Ionicons
              name={transaction.ignored ? "eye-outline" : "eye-off-outline"}
              size={13}
              color={colors.accent}
            />
            <Text style={styles.actionLinkText}>{transaction.ignored ? "Include" : "Ignore"}</Text>
          </Pressable>
        )}
        {onFindTransferCandidates && onLinkTransfer && !transaction.linkedTransactionId && (
          <Pressable onPress={togglePickingLink} style={styles.actionBtn}>
            <Ionicons name="swap-horizontal-outline" size={13} color={colors.accent} />
            <Text style={styles.actionLinkText}>{pickingLink ? "Cancel" : "Link transfer"}</Text>
          </Pressable>
        )}
        {onDelete && (
          <Pressable onPress={() => setConfirmingDelete((v) => !v)} style={styles.actionBtn}>
            <Ionicons name="trash-outline" size={13} color={DANGER} />
            <Text style={styles.deleteLinkText}>{confirmingDelete ? "Cancel" : "Delete"}</Text>
          </Pressable>
        )}
      </View>

      {editingPaidBack && (
        <View style={styles.noteEditor}>
          <Text style={styles.meta}>Did someone pay you back for part of this?</Text>
          <View style={styles.tagEditorRow}>
            <TextInput
              value={paidBackInput}
              onChangeText={setPaidBackInput}
              keyboardType="decimal-pad"
              placeholder={`Amount, up to $${charge.toFixed(2)}`}
              placeholderTextColor={colors.textSecondary}
              style={[styles.noteInput, styles.tagInput]}
              autoFocus
            />
            <Pressable onPress={() => setPaidBackInput((charge / 2).toFixed(2))} style={styles.suggestionChip}>
              <Text style={styles.suggestionText}>Half (${(charge / 2).toFixed(2)})</Text>
            </Pressable>
          </View>
          <View style={styles.categoryRow}>
            {["Cash", "Zelle", "Venmo", "Other"].map((via) => (
              <Pressable
                key={via}
                onPress={() => setPaidBackVia(via)}
                style={[styles.categoryOption, paidBackVia === via && styles.recurringOptionActive]}
              >
                <Text style={[styles.categoryOptionText, paidBackVia === via && styles.recurringOptionTextActive]}>{via}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.noteActions}>
            {reimbursed ? (
              <Pressable onPress={() => savePaidBack(null)} style={styles.noteCancelBtn}>
                <Text style={styles.noteCancelText}>Remove</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setEditingPaidBack(false)} style={styles.noteCancelBtn}>
                <Text style={styles.noteCancelText}>Cancel</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                const v = Number(paidBackInput.replace(/[$,\s]/g, ""));
                if (Number.isFinite(v) && v > 0) savePaidBack(v);
              }}
              style={styles.noteSaveBtn}
            >
              <Text style={styles.noteSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

      {pickingRecurring && (
        <View style={styles.noteEditor}>
          <Text style={styles.meta}>
            Is {formatMerchantName(transaction.merchant)} a subscription? This applies to all its charges.
          </Text>
          <View style={styles.categoryRow}>
            {(
              [
                ["subscription", "Yes, track it"],
                ["not", "No, never"],
                [null, "Let the app decide"],
              ] as const
            ).map(([choice, label]) => (
              <Pressable
                key={label}
                onPress={() => chooseRecurring(choice)}
                style={[styles.categoryOption, recurringChoice === choice && styles.recurringOptionActive]}
              >
                <Text style={[styles.categoryOptionText, recurringChoice === choice && styles.recurringOptionTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => router.push("/subscriptions")}>
            <Text style={styles.actionLinkText}>See all subscriptions →</Text>
          </Pressable>
        </View>
      )}

      {editingNote && (
        <View style={styles.noteEditor}>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="Add a note, e.g. Work trip — get reimbursed"
            placeholderTextColor={colors.textSecondary}
            style={[styles.noteInput, styles.noteInputMultiline]}
            multiline
            autoFocus
          />
          <View style={styles.tagEditorRow}>
            {tagsDraft.map((tag) => (
              <Pressable
                key={tag}
                onPress={() => setTagsDraft(tagsDraft.filter((t) => t !== tag))}
                style={[styles.tagChip, styles.tagChipEditing]}
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <Text style={styles.tagChipText}>#{tag}</Text>
                <Ionicons name="close" size={12} color={colors.accent} />
              </Pressable>
            ))}
            <TextInput
              value={tagInput}
              onChangeText={handleTagInput}
              onSubmitEditing={() => addTag(tagInput)}
              placeholder={tagsDraft.length ? "Add another tag" : "Add tags, e.g. work-trip"}
              placeholderTextColor={colors.textSecondary}
              style={[styles.noteInput, styles.tagInput]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={false}
            />
          </View>
          {suggestions.length > 0 && (
            <View style={styles.tagEditorRow}>
              {suggestions.map((tag) => (
                <Pressable key={tag} onPress={() => addTag(tag)} style={styles.suggestionChip}>
                  <Text style={styles.suggestionText}>+ #{tag}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.noteActions}>
            <Pressable onPress={() => setEditingNote(false)} style={styles.noteCancelBtn}>
              <Text style={styles.noteCancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={saveNote} style={styles.noteSaveBtn}>
              <Text style={styles.noteSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

      {pickingLink && (
        <View style={styles.categoryRow}>
          {linkCandidates === null && <Text style={styles.meta}>Looking for matches…</Text>}
          {linkCandidates !== null && linkCandidates.length === 0 && (
            <Text style={styles.meta}>
              No matching transaction found within a week with the opposite amount on another account.
            </Text>
          )}
          {linkCandidates?.map((c) => (
            <Pressable
              key={c.id}
              style={styles.categoryOption}
              onPress={() => {
                onLinkTransfer?.(transaction, c.id);
                setPickingLink(false);
              }}
            >
              <Text style={styles.categoryOptionText}>
                {formatMerchantName(c.merchant)} · {c.accountName} · {c.date}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {confirmingDelete && onDelete && (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>Delete this transaction? This can't be undone.</Text>
          <Pressable
            onPress={() => {
              onDelete(transaction);
              setConfirmingDelete(false);
            }}
          >
            <Text style={styles.confirmDeleteText}>Yes, delete</Text>
          </Pressable>
        </View>
      )}

      {pickingCategory && categories && onChangeCategory && (
        <View style={styles.categoryRow}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              style={styles.categoryOption}
              onPress={() => {
                onChangeCategory(transaction, c.id);
                setPickingCategory(false);
              }}
            >
              <Text style={styles.categoryOptionText}>
                {getCategoryStyle(c.name).emoji} {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      gap: spacing.xs,
    },
    ignoredCard: { opacity: 0.55 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    avatarEmoji: { fontSize: 16 },
    merchant: { fontSize: 14, fontWeight: "600", color: colors.textPrimary, marginBottom: 2 },
    meta: { fontSize: 12, color: colors.textSecondary, marginBottom: 6 },
    chipRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    categoryChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.chip,
      alignSelf: "flex-start",
    },
    categoryChipEmoji: { fontSize: 12 },
    categoryChipLabel: { fontSize: 12, fontWeight: "600" },
    linkedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
    linkedText: { flex: 1, fontSize: 11, color: colors.accent, fontWeight: "600" },
    actionsRow: {
      flexDirection: "row",
      gap: spacing.md,
      flexWrap: "wrap",
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    actionLinkText: { fontSize: 12, color: colors.accent, fontWeight: "600" },
    deleteLinkText: { fontSize: 12, color: DANGER, fontWeight: "600" },
    confirmRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
      backgroundColor: DANGER_LIGHT,
      borderRadius: radius.chip,
      padding: spacing.sm,
      marginTop: spacing.xs,
    },
    confirmText: { fontSize: 12, color: DANGER, fontWeight: "600", flex: 1 },
    confirmDeleteText: { fontSize: 12, color: DANGER, fontWeight: "700", textDecorationLine: "underline" },
    categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
    categoryOption: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    categoryOptionText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
    tagChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: "#EDE9FE",
    },
    tagChipEditing: { paddingVertical: 5 },
    recurringOptionActive: { borderColor: "#4C1D95", backgroundColor: "#EDE9FE" },
    recurringOptionTextActive: { color: "#4C1D95" },
    tagChipText: { fontSize: 12, fontWeight: "700", color: "#4C1D95" },
    paidBackText: { fontSize: 12, color: "#16A34A", fontWeight: "600", marginTop: 6 },
    noteText: { fontSize: 12, color: colors.textSecondary, marginTop: 6, fontStyle: "italic", lineHeight: 17 },
    noteEditor: { gap: spacing.sm, marginTop: spacing.xs },
    noteInput: {
      backgroundColor: colors.background,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textPrimary,
    },
    noteInputMultiline: { minHeight: 60, textAlignVertical: "top" },
    tagEditorRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
    tagInput: { flexGrow: 1, minWidth: 150 },
    suggestionChip: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    suggestionText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    noteActions: { flexDirection: "row", gap: spacing.sm },
    noteCancelBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
    },
    noteCancelText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
    noteSaveBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill, backgroundColor: "#4C1D95" },
    noteSaveText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  });
}
