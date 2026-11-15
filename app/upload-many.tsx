import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatAmount } from "../components/AmountText";
import { PdfTextExtractor, type PdfTextExtractorHandle } from "../components/PdfTextExtractor";
import { autoBackup } from "../lib/autoBackup";
import { findDuplicates, guessAccount, MAX_FILES, readCsvText, readStatementText, saveOrder, summarize, type ReadFile } from "../lib/batchUpload";
import {
  autoLinkTransfers,
  getAccounts,
  getDuplicateLookup,
  insertExtractedTransactions,
  learnStatementClosing,
  setAccountBalanceCheckpoint,
} from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import type { Account } from "../lib/types";

const ACCENT = "#4C1D95";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

type Item = {
  id: string;
  name: string;
  uri: string;
  isCsv: boolean;
  state: "waiting" | "reading" | "ready" | "failed";
  error: string | null;
  // The PDF's text, kept so changing the account re-reads its balance (a
  // card's and a bank account's are printed differently).
  text: string | null;
  read: ReadFile | null;
  accountId: number | null;
  include: boolean;
  open: boolean;
};

type Result = { statements: number; transactions: number; watched: number; linked: number; balances: string[]; noClosingDay: string[] };

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

// Several statements at once: pick them together, check them on one screen,
// save them all with one tap. Same reading and saving as the single upload.
export default function UploadManyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const extractorRef = useRef<PdfTextExtractorHandle>(null);
  const { accountId: accountParam } = useLocalSearchParams<{ accountId?: string }>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [saved, setSaved] = useState<Map<number, Set<string>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tooMany, setTooMany] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getAccounts(db).then(setAccounts);
    }, [db])
  );

  const update = (id: string, change: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i)));
  const accountOf = (id: number | null) => accounts.find((a) => a.id === id) ?? null;

  async function pickFiles() {
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: true,
      // Windows reports .csv files as application/vnd.ms-excel.
      type: ["application/pdf", "text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
    });
    if (picked.canceled) return;
    setResult(null);
    setTooMany(picked.assets.length > MAX_FILES);
    const fallback = accounts.find((a) => String(a.id) === accountParam)?.id ?? accounts[0]?.id ?? null;
    const added: Item[] = picked.assets.slice(0, MAX_FILES).map((f, n) => ({
      id: `${Date.now()}-${n}`,
      name: f.name,
      uri: f.uri,
      isCsv: /\.csv$/i.test(f.name) || /csv/i.test(f.mimeType ?? ""),
      state: "waiting",
      error: null,
      text: null,
      read: null,
      accountId: guessAccount(f.name, accounts) ?? fallback,
      include: true,
      open: false,
    }));
    setItems(added);
    // One at a time: each PDF goes to the statement reader on its own.
    for (const item of added) {
      update(item.id, { state: "reading" });
      try {
        if (item.isCsv) {
          const read = readCsvText(await (await fetch(item.uri)).text());
          update(item.id, { state: "ready", read });
        } else {
          if (!extractorRef.current) throw new Error("The statement reader isn't ready. Try again.");
          const text = await extractorRef.current.extractText(item.uri);
          const isCard = accountOf(item.accountId)?.type === "Credit Card";
          update(item.id, { state: "ready", text, read: readStatementText(text, isCard) });
        }
      } catch (err) {
        update(item.id, { state: "failed", include: false, error: err instanceof Error ? err.message : "Couldn't read this file." });
      }
    }
  }

  // What's already saved on each account, for spotting duplicates.
  const accountKey = items.map((i) => i.accountId).join(",");
  useEffect(() => {
    const ids = [...new Set(items.map((i) => i.accountId).filter((id): id is number => id !== null))];
    Promise.all(ids.map(async (id) => [id, new Set((await getDuplicateLookup(db, id)).keys())] as const)).then((entries) => setSaved(new Map(entries)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, accountKey]);

  function changeAccount(item: Item, accountId: number) {
    const isCard = accountOf(accountId)?.type === "Credit Card";
    update(item.id, { accountId, read: item.text !== null ? readStatementText(item.text, isCard) : item.read });
  }

  const dupes = findDuplicates(
    items.map((i) => ({ accountId: i.accountId, rows: i.read?.rows ?? [] })),
    (id) => saved.get(id) ?? new Set()
  );
  // A file that's all duplicates starts unticked, once.
  const [autoUnticked, setAutoUnticked] = useState<Set<string>>(new Set());
  useEffect(() => {
    items.forEach((item, n) => {
      if (item.state === "ready" && dupes[n].allDuplicates && !autoUnticked.has(item.id)) {
        setAutoUnticked((s) => new Set(s).add(item.id));
        update(item.id, { include: false });
      }
    });
  });

  const reading = items.some((i) => i.state === "waiting" || i.state === "reading");
  const toSave = items.filter((i) => i.include && i.state === "ready" && i.accountId !== null && (i.read?.rows.length ?? 0) > 0);

  async function saveAll() {
    setSaving(true);
    const out: Result = { statements: 0, transactions: 0, watched: 0, linked: 0, balances: [], noClosingDay: [] };
    for (const item of saveOrder(toSave)) {
      const read = item.read!;
      const accountId = item.accountId!;
      out.watched += await insertExtractedTransactions(db, accountId, read.rows);
      // Fresh each time: the statement before may have just set its closing day.
      const account = (await getAccounts(db)).find((a) => a.id === accountId);
      if (account) {
        const last = summarize(read.rows).last;
        const learned = await learnStatementClosing(db, account, item.isCsv ? null : read.closing, last, item.isCsv);
        if (learned.ask && !out.noClosingDay.includes(account.name)) out.noClosingDay.push(account.name);
        if (read.balance) {
          const isCard = account.type === "Credit Card";
          await setAccountBalanceCheckpoint(db, accountId, isCard ? -read.balance.balance : read.balance.balance, read.balance.date);
          out.balances.push(
            isCard
              ? `${account.name}: you owe ${money(read.balance.balance)} as of ${shortDate(read.balance.date)}`
              : `${account.name}: ${formatAmount(read.balance.balance)} as of ${shortDate(read.balance.date)}`
          );
        }
      }
      out.statements += 1;
      out.transactions += read.rows.length;
    }
    out.linked = await autoLinkTransfers(db);
    autoBackup(db);
    // Only the newest balance for each account matters.
    out.balances = [...new Map(out.balances.map((b) => [b.split(":")[0], b])).values()];
    setResult(out);
    setItems([]);
    setSaving(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Upload several</Text>
          <View style={styles.headerBtn} />
        </View>

        {accounts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.body}>You need an account before uploading statements.</Text>
            <Pressable onPress={() => router.push("/accounts")}>
              <Text style={styles.link}>Add an account</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.body}>
              Pick up to {MAX_FILES} PDF statements or CSV files at once, for one account or several. Fia reads them all, then you check them and save them together.
            </Text>
            <Pressable onPress={pickFiles} disabled={reading || saving} style={[styles.pickBtn, (reading || saving) && { opacity: 0.5 }]}>
              <Ionicons name="documents-outline" size={18} color={colors.accent} />
              <Text style={styles.pickText}>{items.length ? "Choose different files" : "Choose files"}</Text>
            </Pressable>
            {tooMany && <Text style={styles.warn}>Only the first {MAX_FILES} files are shown. Upload the rest after these.</Text>}
          </View>
        )}

        <PdfTextExtractor ref={extractorRef} />

        {items.map((item, n) => {
          const read = item.read;
          const summary = read ? summarize(read.rows) : null;
          const account = accountOf(item.accountId);
          const dup = dupes[n];
          return (
            <View key={item.id} style={[styles.card, !item.include && item.state === "ready" && styles.cardOff]}>
              <View style={styles.fileTop}>
                <Ionicons name={item.isCsv ? "grid-outline" : "document-text-outline"} size={18} color={colors.accent} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.state === "ready" && (read?.rows.length ?? 0) > 0 && (
                  <Pressable
                    onPress={() => update(item.id, { include: !item.include })}
                    hitSlop={8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.include }}
                    accessibilityLabel={`Save ${item.name}`}
                  >
                    <Ionicons name={item.include ? "checkbox" : "square-outline"} size={22} color={colors.accent} />
                  </Pressable>
                )}
              </View>

              {(item.state === "waiting" || item.state === "reading") && (
                <View style={styles.row}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.meta}>{item.state === "reading" ? "Reading..." : "Waiting..."}</Text>
                </View>
              )}
              {item.state === "failed" && <Text style={styles.error}>{item.error}</Text>}

              {item.state === "ready" && read && summary && (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accounts}>
                    {accounts.map((a) => {
                      const on = a.id === item.accountId;
                      return (
                        <Pressable key={a.id} onPress={() => changeAccount(item, a.id)} style={[styles.chip, on && styles.chipOn]} accessibilityLabel={`${item.name}: ${a.name}`}>
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {summary.count === 0 ? (
                    <Text style={styles.warn}>
                      No transactions found. Upload this one on its own to see why, or try the bank's CSV download.
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.summary}>
                        {summary.count} transaction{summary.count === 1 ? "" : "s"} · {shortDate(summary.first)} – {shortDate(summary.last)}
                      </Text>
                      <Text style={styles.meta}>
                        Out {money(summary.out)} · In {money(summary.in)}
                        {read.balance
                          ? account?.type === "Credit Card"
                            ? ` · Statement balance ${money(read.balance.balance)}`
                            : ` · Ending balance ${formatAmount(read.balance.balance)}`
                          : ""}
                      </Text>
                      {dup.allDuplicates ? (
                        <Text style={styles.warn}>Looks already uploaded: every transaction is already on {account?.name ?? "this account"}. Left unticked.</Text>
                      ) : dup.duplicates > 0 ? (
                        <Text style={styles.warn}>
                          {dup.duplicates} possible duplicate{dup.duplicates === 1 ? "" : "s"} (same date and amount already on {account?.name ?? "this account"}).
                        </Text>
                      ) : null}
                      <Pressable onPress={() => update(item.id, { open: !item.open })} hitSlop={6}>
                        <Text style={styles.link}>{item.open ? "Hide transactions" : "Show transactions"}</Text>
                      </Pressable>
                      {item.open &&
                        read.rows.map((t, i) => (
                          <View key={i} style={styles.txRow}>
                            <Text style={styles.txDate}>{t.date.slice(5)}</Text>
                            <Text style={styles.txName} numberOfLines={1}>
                              {formatMerchantName(t.merchant)}
                            </Text>
                            <Text style={[styles.txAmount, { color: t.amount < 0 ? "#DC2626" : "#16A34A" }]}>{formatAmount(t.amount)}</Text>
                          </View>
                        ))}
                    </>
                  )}
                </>
              )}
            </View>
          );
        })}

        {items.length > 0 && (
          <>
            <Pressable onPress={saveAll} disabled={reading || saving || toSave.length === 0} style={[styles.saveWrap, (reading || saving || toSave.length === 0) && { opacity: 0.5 }]}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.saveBtn}>
                <Text style={styles.saveText}>
                  {saving ? "Saving..." : reading ? "Reading files..." : `Save ${toSave.length} statement${toSave.length === 1 ? "" : "s"}`}
                </Text>
              </LinearGradient>
            </Pressable>
            <Text style={styles.hint}>
              Dates or signs look wrong in one? Untick it and upload it on its own, where you can pick the year or flip + and −.
            </Text>
          </>
        )}

        {result && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
              <Text style={styles.done}>
                Saved {result.statements} statement{result.statements === 1 ? "" : "s"} · {result.transactions} transactions
              </Text>
            </View>
            {result.watched > 0 && (
              <Pressable onPress={() => router.push("/watch-list")} style={styles.watch}>
                <Text style={styles.watchText}>
                  👀 Found {result.watched} transaction{result.watched === 1 ? "" : "s"} you were watching for ›
                </Text>
              </Pressable>
            )}
            {result.balances.map((b) => (
              <Text key={b} style={styles.meta}>
                Updated {b}
              </Text>
            ))}
            {result.linked > 0 && (
              <Text style={styles.meta}>
                Linked {result.linked} transfer{result.linked === 1 ? "" : "s"} between your accounts, so {result.linked === 1 ? "it isn't" : "they aren't"} counted as spending.
              </Text>
            )}
            {result.noClosingDay.length > 0 && (
              <Text style={styles.meta}>
                Fia couldn't find when {result.noClosingDay.join(" and ")} statements close. Set it on Home so reminders come at the right time.
              </Text>
            )}
            <Pressable onPress={() => router.push("/review")}>
              <Text style={styles.link}>Sort new transactions ›</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.sm + 4 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardOff: { opacity: 0.6 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
    pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.accent },
    pickText: { fontSize: 15, fontWeight: "700", color: colors.accent },
    fileTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    fileName: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    accounts: { gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
    chipText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    chipTextOn: { color: "#FFFFFF" },
    summary: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
    meta: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    warn: { fontSize: 12, color: "#B45309", fontWeight: "600", lineHeight: 17 },
    error: { fontSize: 12, color: "#DC2626", fontWeight: "600", lineHeight: 17 },
    link: { fontSize: 13, fontWeight: "700", color: colors.accent },
    txRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    txDate: { fontSize: 12, color: colors.textSecondary, width: 42 },
    txName: { flex: 1, fontSize: 13, color: colors.textPrimary },
    txAmount: { fontSize: 13, fontWeight: "700" },
    saveWrap: { borderRadius: radius.pill, overflow: "hidden" },
    saveBtn: { paddingVertical: 15, alignItems: "center" },
    saveText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
    hint: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 17 },
    done: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    watch: { backgroundColor: "#FEF3C7", borderRadius: radius.chip, padding: spacing.sm },
    watchText: { fontSize: 13, fontWeight: "700", color: "#92400E" },
  });
}
