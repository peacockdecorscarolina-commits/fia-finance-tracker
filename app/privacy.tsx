import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const UPDATED = "November 5, 2026";

// What Fia keeps and where -- linked from Google's sign-in screen, so it's
// open to anyone without signing in (see PUBLIC_PATHS in AccessGate).
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "The short version",
    body: [
      "Your financial data stays on your device and, if you turn on backup, in your own Google Drive. The person who makes Fia can't see your transactions, balances or statements.",
      "Fia keeps one thing about you on its side: your email address, so it knows who's using the app.",
    ],
  },
  {
    title: "What stays on your device",
    body: [
      "Your accounts, transactions, categories, notes, balances and settings are stored in your browser on this device. They aren't sent to Fia's servers.",
    ],
  },
  {
    title: "Your Google Drive backup",
    body: [
      "If you back up, Fia saves a copy of your data in a hidden folder in your own Google Drive that only Fia can open. It doesn't touch, read or list any of your other files. You can delete it any time from Google Drive (Settings > Manage apps).",
    ],
  },
  {
    title: "Reading PDF statements",
    body: [
      "To read a PDF statement, its text is sent to Fia's server, read, and sent straight back. It isn't saved or logged. CSV files are read entirely on your device.",
    ],
  },
  {
    title: "Your email address",
    body: [
      "When you sign in with Google, Fia records your email address, when you first and last opened the app, and whether your access is active. This is used to know who's using Fia, to contact you about the app, and to manage access (and payment, once Fia is paid for). It's kept in a private Google Sheet only the developer can see, and it's never sold or shared.",
    ],
  },
  {
    title: "Feedback",
    body: [
      "If you send feedback, it includes only what you write, the screen you were on, the app version and your browser. You can add your email if you'd like a reply, and you can choose to include a statement's text when reporting a bank Fia couldn't read (card and account numbers are hidden).",
    ],
  },
  {
    title: "Deleting your data",
    body: [
      "Everything on your device can be removed by clearing this site's data in your browser (or deleting Fia from your home screen). Your Drive backup can be deleted from Google Drive. To have your email removed from Fia's list, send a request through Send feedback in the app.",
    ],
  },
];

export default function PrivacyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Privacy</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.updated}>Last updated {UPDATED}</Text>
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.card}>
            <Text style={styles.cardTitle}>{s.title}</Text>
            {s.body.map((p) => (
              <Text key={p.slice(0, 24)} style={styles.paragraph}>
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md, maxWidth: 720, width: "100%", alignSelf: "center" },
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
    updated: { fontSize: 12, color: colors.textSecondary, textAlign: "center" },
    card: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    paragraph: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  });
}
