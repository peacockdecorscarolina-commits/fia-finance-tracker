import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getSetting, setSetting } from "../lib/db";
import { isSignedIn } from "../lib/googleAuth";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const BACKUP_SNOOZED_UNTIL_KEY = "backup_banner_snoozed_until";
const HOME_SCREEN_TIP_DISMISSED_KEY = "home_screen_tip_dismissed";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type Banner = "backup" | "homeScreen" | null;

function isIosBrowserTab(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; touch support gives it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

// Everything lives in this browser's storage, so on Home this nudges the
// two things that keep it safe, one at a time: a Drive backup (not signed
// in yet) and, on iPhone/iPad, adding the app to the Home Screen -- Safari
// clears storage for sites that go unopened for about a week, but not for
// Home Screen apps. Web only.
export function DataSafetyBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [banner, setBanner] = useState<Banner>(null);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web") return;
      (async () => {
        if (!isSignedIn()) {
          const snoozedUntil = await getSetting(db, BACKUP_SNOOZED_UNTIL_KEY);
          if (!snoozedUntil || Date.now() > Number(snoozedUntil)) {
            setBanner("backup");
            return;
          }
        }
        if (isIosBrowserTab() && (await getSetting(db, HOME_SCREEN_TIP_DISMISSED_KEY)) === null) {
          setBanner("homeScreen");
          return;
        }
        setBanner(null);
      })();
    }, [db])
  );

  async function dismiss() {
    if (banner === "backup") await setSetting(db, BACKUP_SNOOZED_UNTIL_KEY, String(Date.now() + SNOOZE_MS));
    if (banner === "homeScreen") await setSetting(db, HOME_SCREEN_TIP_DISMISSED_KEY, "1");
    setBanner(null);
  }

  if (!banner) return null;

  const content =
    banner === "backup"
      ? {
          icon: "cloud-offline-outline" as const,
          title: "Your data isn't backed up",
          text: "It's only saved in this browser. Sign in with Google to keep a backup in your Drive.",
          action: "Back up",
          onAction: () => router.push("/sync"),
          dismissLabel: "Later",
        }
      : {
          icon: "phone-portrait-outline" as const,
          title: "Add Fia to your Home Screen",
          text: "Safari can clear data for sites you don't open for a week. Tap Share, then “Add to Home Screen” to keep it safe.",
          action: null,
          onAction: null,
          dismissLabel: "Got it",
        };

  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Ionicons name={content.icon} size={18} color={ACCENT} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{content.title}</Text>
        <Text style={styles.text}>{content.text}</Text>
        <View style={styles.actions}>
          {content.action && content.onAction && (
            <Pressable onPress={content.onAction} style={styles.actionBtn}>
              <Text style={styles.actionText}>{content.action}</Text>
            </Pressable>
          )}
          <Pressable onPress={dismiss} style={styles.dismissBtn}>
            <Text style={styles.dismissText}>{content.dismissLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1.5,
      borderColor: "#DDD6FE",
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "#EDE9FE",
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
    text: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    actionBtn: { backgroundColor: ACCENT, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
    actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
    dismissBtn: { paddingHorizontal: spacing.sm, paddingVertical: 7 },
    dismissText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  });
}
