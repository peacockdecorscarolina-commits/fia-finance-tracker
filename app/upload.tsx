import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatAmount } from "../components/AmountText";
import { PdfTextExtractor, type PdfTextExtractorHandle } from "../components/PdfTextExtractor";
import { getAccountStyle } from "../lib/accountStyle";
import { getCategoryStyle } from "../lib/categoryStyle";
import { getAccounts, insertExtractedTransactions } from "../lib/db";
import { formatMerchantName } from "../lib/formatMerchant";
import { parseStatement } from "../lib/parseStatement";
import { radius, spacing } from "../lib/theme";
import type { Account, ExtractedTransaction } from "../lib/types";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const ACCENT_LIGHT = "#EDE9FE";
const GRADIENT = ["#4C1D95", "#312E81"] as const;

const neutral = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

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

  const headerRow = (
    <View style={styles.headerRow}>
      <Pressable onPress={() => router.back()} style={styles.headerBtn}>
        <Ionicons name="arrow-back" size={20} color={neutral.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle}>Upload Statement</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  if (accounts.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {headerRow}
          <View style={styles.centered}>
            <Text style={styles.empty}>You need an account before uploading a statement.</Text>
            <Pressable onPress={() => router.push("/accounts")} style={styles.primaryBtnWrap}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Add an account</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {headerRow}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.chipRow}>
            {accounts.map((a) => {
              const active = a.id === accountId;
              const style = getAccountStyle(a.name);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.accountChip, active && styles.accountChipActive]}
                >
                  <View style={[styles.accountChipIcon, { backgroundColor: style.color }]}>
                    <Text style={styles.accountChipIconText}>{a.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.accountChipText, active && styles.accountChipTextActive]}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Statement PDF</Text>
          <Pressable style={styles.pickButton} onPress={pickFile}>
            <Ionicons name="document-attach-outline" size={18} color={ACCENT} />
            <Text style={styles.pickButtonText}>{fileName ?? "Choose a PDF file"}</Text>
          </Pressable>

          {status !== "preview" && status !== "saved" && (
            <Pressable
              onPress={process}
              disabled={!fileUri || status === "processing"}
              style={[styles.primaryBtnWrap, (!fileUri || status === "processing") && { opacity: 0.5 }]}
            >
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>
                  {status === "processing" ? "Processing..." : "Process Statement"}
                </Text>
              </LinearGradient>
            </Pressable>
          )}
          {status === "processing" && <ActivityIndicator color={ACCENT} style={{ marginTop: spacing.sm }} />}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        <PdfTextExtractor ref={extractorRef} />

        {status === "saved" && (
          <View style={styles.sectionCard}>
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
              <Text style={styles.savedText}>Saved! Check the Transactions tab.</Text>
            </View>
          </View>
        )}

        {status === "preview" && (
          <View style={styles.sectionCard}>
            <Text style={styles.previewTitle}>
              Found {extracted.length} transactions for {selectedAccount?.name ?? "this account"} — review, then
              save
            </Text>
            {extracted.map((t, i) => {
              const style = getCategoryStyle(t.category);
              return (
                <View key={i} style={styles.previewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewMerchant}>{formatMerchantName(t.merchant)}</Text>
                    <View style={styles.previewMeta}>
                      <Text style={styles.previewDate}>{t.date}</Text>
                      <View style={[styles.previewChip, { backgroundColor: `${style.color}1F` }]}>
                        <Text style={[styles.previewChipText, { color: style.color }]}>
                          {style.emoji} {t.category}
                        </Text>
                      </View>
                      {t.needsReview && (
                        <View style={styles.reviewChip}>
                          <Text style={styles.reviewChipText}>needs review</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={[styles.previewAmount, { color: t.amount < 0 ? "#DC2626" : "#16A34A" }]}>
                    {formatAmount(t.amount)}
                  </Text>
                </View>
              );
            })}
            {!confirmingSave ? (
              <View style={styles.previewActions}>
                <Pressable onPress={reset} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => setConfirmingSave(true)} style={{ flex: 1 }}>
                  <LinearGradient
                    colors={GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Save to account</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  Save {extracted.length} transaction{extracted.length === 1 ? "" : "s"} to{" "}
                  <Text style={styles.confirmAccountName}>{selectedAccount?.name ?? "this account"}</Text>?
                </Text>
                <View style={styles.previewActions}>
                  <Pressable onPress={() => setConfirmingSave(false)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>No, go back</Text>
                  </Pressable>
                  <Pressable onPress={save} style={{ flex: 1 }}>
                    <LinearGradient
                      colors={GRADIENT}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.primaryBtn}
                    >
                      <Text style={styles.primaryBtnText}>Yes, save</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: neutral.background },
  container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: neutral.textPrimary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  sectionCard: { backgroundColor: neutral.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: neutral.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.xs,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  accountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: neutral.card,
    borderWidth: 1.5,
    borderColor: neutral.border,
  },
  accountChipActive: { borderColor: ACCENT, backgroundColor: ACCENT_LIGHT },
  accountChipIcon: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  accountChipIconText: { color: "#FFFFFF", fontSize: 8, fontWeight: "700" },
  accountChipText: { color: neutral.textSecondary, fontWeight: "600", fontSize: 13 },
  accountChipTextActive: { color: ACCENT },
  pickButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: neutral.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: neutral.border,
    borderStyle: "dashed",
    paddingVertical: spacing.md,
  },
  pickButtonText: { color: neutral.textPrimary, fontWeight: "600", fontSize: 14 },
  primaryBtnWrap: { borderRadius: radius.pill, overflow: "hidden" },
  primaryBtn: { paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  empty: { textAlign: "center", color: neutral.textSecondary, fontSize: 14 },
  errorText: { color: "#DC2626", fontSize: 13, marginTop: spacing.sm },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  savedText: { textAlign: "center", color: "#16A34A", fontWeight: "600" },
  previewTitle: { fontWeight: "600", color: neutral.textPrimary, marginBottom: spacing.xs, fontSize: 13 },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: neutral.border,
  },
  previewMerchant: { fontWeight: "600", color: neutral.textPrimary, marginBottom: 4, fontSize: 13 },
  previewMeta: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  previewDate: { fontSize: 12, color: neutral.textSecondary, marginRight: 4 },
  previewChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.chip },
  previewChipText: { fontSize: 11, fontWeight: "600" },
  reviewChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.chip, backgroundColor: "#FEF3C7" },
  reviewChipText: { fontSize: 11, fontWeight: "600", color: "#B45309" },
  previewAmount: { fontSize: 13, fontWeight: "700" },
  previewActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: neutral.background,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: neutral.textSecondary },
  confirmBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.chip,
    backgroundColor: ACCENT_LIGHT,
  },
  confirmText: { fontSize: 14, color: neutral.textPrimary, marginBottom: spacing.sm },
  confirmAccountName: { fontWeight: "700" },
});
