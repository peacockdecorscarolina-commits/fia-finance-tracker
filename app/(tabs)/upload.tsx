import * as DocumentPicker from "expo-document-picker";
import { Link, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AmountText } from "../../components/AmountText";
import { Card } from "../../components/Card";
import { Chip } from "../../components/Chip";
import { PdfTextExtractor, type PdfTextExtractorHandle } from "../../components/PdfTextExtractor";
import { PillButton } from "../../components/PillButton";
import { Screen } from "../../components/Screen";
import { getAccounts, insertExtractedTransactions } from "../../lib/db";
import { parseStatement } from "../../lib/parseStatement";
import { colors, radius, spacing, tabBarClearance } from "../../lib/theme";
import type { Account, ExtractedTransaction } from "../../lib/types";

export default function UploadScreen() {
  const db = useSQLiteContext();
  const extractorRef = useRef<PdfTextExtractorHandle>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "preview" | "saved">("idle");
  const [extracted, setExtracted] = useState<ExtractedTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  useFocusEffect(
    useCallback(() => {
      getAccounts(db).then((list) => {
        setAccounts(list);
        setAccountId((current) => current ?? list[0]?.id ?? null);
      });
    }, [db])
  );

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
    if (result.canceled) return;
    const file = result.assets[0];
    setFileName(file.name);
    setFileUri(file.uri);
    setStatus("idle");
  }

  async function process() {
    if (!fileUri || !extractorRef.current) return;
    setStatus("processing");
    setError(null);
    try {
      const text = await extractorRef.current.extractText(fileUri);
      setExtracted(parseStatement(text));
      setStatus("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read that PDF.");
      setStatus("idle");
    }
  }

  async function save() {
    if (!accountId) return;
    await insertExtractedTransactions(db, accountId, extracted);
    setStatus("saved");
    setFileName(null);
    setFileUri(null);
    setExtracted([]);
    setConfirmingSave(false);
  }

  function reset() {
    setStatus("idle");
    setFileName(null);
    setFileUri(null);
    setExtracted([]);
    setConfirmingSave(false);
  }

  if (accounts.length === 0) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={styles.title}>Upload</Text>
          <Text style={styles.empty}>
            You need an account before uploading a statement.
          </Text>
          <Link href="/accounts" asChild>
            <PillButton title="Add an account" onPress={() => {}} />
          </Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Upload Statement</Text>

        <Card style={styles.card}>
          <Text style={styles.label}>Account</Text>
          <View style={styles.chipRow}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.accountChip, active && styles.accountChipActive]}
                >
                  <Text style={[styles.accountChipText, active && styles.accountChipTextActive]}>
                    {a.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Statement PDF</Text>
          <Pressable style={styles.pickButton} onPress={pickFile}>
            <Text style={styles.pickButtonText}>
              {fileName ?? "Choose a PDF file"}
            </Text>
          </Pressable>

          {status !== "preview" && status !== "saved" && (
            <PillButton
              title={status === "processing" ? "Processing..." : "Process Statement"}
              onPress={process}
              disabled={!fileUri || status === "processing"}
            />
          )}
          {status === "processing" && <ActivityIndicator style={{ marginTop: spacing.sm }} />}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </Card>

        <PdfTextExtractor ref={extractorRef} />

        {status === "saved" && (
          <Card style={styles.card}>
            <Text style={styles.savedText}>Saved! Check the Transactions tab.</Text>
          </Card>
        )}

        {status === "preview" && (
          <Card style={styles.card}>
            <Text style={styles.previewTitle}>
              Found {extracted.length} transactions for {selectedAccount?.name ?? "this account"} —
              review, then save
            </Text>
            {extracted.map((t, i) => (
              <View key={i} style={styles.previewRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewMerchant}>{t.merchant}</Text>
                  <View style={styles.previewMeta}>
                    <Text style={styles.previewDate}>{t.date}</Text>
                    <Chip label={t.category} />
                    {t.needsReview && <Chip label="needs review" tone="warning" />}
                  </View>
                </View>
                <AmountText amount={t.amount} size="sm" />
              </View>
            ))}
            {!confirmingSave ? (
              <View style={styles.previewActions}>
                <PillButton title="Save to account" onPress={() => setConfirmingSave(true)} />
                <PillButton title="Cancel" onPress={reset} variant="secondary" />
              </View>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  Save {extracted.length} transaction{extracted.length === 1 ? "" : "s"} to{" "}
                  <Text style={styles.confirmAccountName}>{selectedAccount?.name ?? "this account"}</Text>?
                </Text>
                <View style={styles.previewActions}>
                  <PillButton title="Yes, save" onPress={save} />
                  <PillButton
                    title="No, go back"
                    onPress={() => setConfirmingSave(false)}
                    variant="secondary"
                  />
                </View>
              </View>
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.md, paddingBottom: tabBarClearance },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  card: { gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  accountChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountChipActive: { backgroundColor: colors.pillActive, borderColor: colors.pillActive },
  accountChipText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  accountChipTextActive: { color: colors.pillActiveText },
  pickButton: {
    backgroundColor: colors.cardSolid,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  pickButtonText: { color: colors.textPrimary, fontWeight: "500" },
  empty: { textAlign: "center", color: colors.textSecondary },
  errorText: { color: colors.negative, fontSize: 13, marginTop: spacing.sm },
  savedText: { textAlign: "center", color: colors.positive, fontWeight: "600" },
  previewTitle: { fontWeight: "600", color: colors.textPrimary, marginBottom: spacing.xs },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewMerchant: { fontWeight: "600", color: colors.textPrimary, marginBottom: 4 },
  previewMeta: { flexDirection: "row", gap: 6, alignItems: "center" },
  previewDate: { fontSize: 12, color: colors.textSecondary, marginRight: 4 },
  previewActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  confirmBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.chip,
    backgroundColor: colors.accentBg,
  },
  confirmText: { fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  confirmAccountName: { fontWeight: "700" },
});
