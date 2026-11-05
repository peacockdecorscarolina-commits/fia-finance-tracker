import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  cachedAccess,
  checkAccess,
  isReadOnlyAccess,
  OFFLINE_GRACE_DAYS,
  onAccessCheckRequested,
  onBlockedWrite,
  setReadOnly,
  type Access,
} from "../lib/access";
import { signIn } from "../lib/googleAuth";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const GRADIENT = ["#4C1D95", "#312E81"] as const;
// Coming back to Fia re-checks access, but not more than this often.
const RECHECK_MS = 60 * 60 * 1000;
// Pages anyone can open without signing in.
const PUBLIC_PATHS = ["/privacy"];

// Everyone signs in with Google to use Fia. Revoked (or offline for too
// long to check) shows a banner and the app turns read-only.
export function AccessGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const pathname = usePathname();
  const [access, setAccess] = useState<Access>({ kind: "loading" });
  const lastCheck = useRef(0);

  const apply = useCallback((next: Access) => {
    setReadOnly(isReadOnlyAccess(next));
    setAccess(next);
  }, []);

  const recheck = useCallback(async () => {
    lastCheck.current = Date.now();
    apply(await checkAccess(db));
  }, [db, apply]);

  useEffect(() => {
    cachedAccess(db).then((quick) => {
      // Signed in but never checked (a first sign-in): straight in, rather
      // than a blank screen while the Sheet answers -- the check below turns
      // the app read-only a moment later if this person is blocked.
      apply(quick.kind === "loading" ? { kind: "active", email: "" } : quick);
      recheck();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck.current > RECHECK_MS) recheck();
    };
    if (Platform.OS === "web") document.addEventListener("visibilitychange", onVisible);
    const stop = onAccessCheckRequested(recheck);
    return () => {
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, [db, apply, recheck]);

  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  if (access.kind === "loading") return <View style={styles.blank} />;
  if (access.kind === "signedOut" || access.kind === "reauth") {
    return <SignInScreen again={access.kind === "reauth"} styles={styles} onSignIn={() => signIn(db, "/")} />;
  }
  return (
    <View style={{ flex: 1 }}>
      {children}
      {isReadOnlyAccess(access) && <ReadOnlyBanner access={access} styles={styles} onRetry={recheck} />}
    </View>
  );
}

function SignInScreen({ again, styles, onSignIn }: { again: boolean; styles: Styles; onSignIn: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.signInPage}>
      <View style={styles.signInCard}>
        <Image source={require("../assets/icon.png")} style={styles.logo} />
        <Text style={styles.title}>{again ? "Sign in again" : "Welcome to Fia"}</Text>
        <Text style={styles.subtitle}>
          {again
            ? "Fia now uses your Google sign-in to keep your access. Your data on this device stays right where it is."
            : "See where your money goes, from your own bank and card statements."}
        </Text>
        {!again && (
          <View style={styles.points}>
            {[
              ["lock-closed-outline", "Your data stays on your device"],
              ["cloud-done-outline", "Backed up to your own Google Drive"],
              ["document-text-outline", "Works with PDF and CSV statements"],
            ].map(([icon, text]) => (
              <View key={text} style={styles.point}>
                <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color="#4C1D95" />
                <Text style={styles.pointText}>{text}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable
          onPress={() => {
            setBusy(true);
            onSignIn();
          }}
          disabled={busy}
          style={[styles.buttonWrap, busy && { opacity: 0.6 }]}
        >
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.button}>
            <Ionicons name="logo-google" size={16} color="#FFFFFF" />
            <Text style={styles.buttonText}>{busy ? "Opening Google..." : "Sign in with Google"}</Text>
          </LinearGradient>
        </Pressable>
        <Text style={styles.footnote}>
          Fia keeps only your email address, so it knows who's using it. It never sees your transactions.{" "}
          <Text style={styles.link} onPress={() => router.push("/privacy")}>
            Privacy
          </Text>
        </Text>
      </View>
    </View>
  );
}

function ReadOnlyBanner({ access, styles, onRetry }: { access: Access; styles: Styles; onRetry: () => void }) {
  const [flash, setFlash] = useState(false);
  useEffect(
    () =>
      onBlockedWrite(() => {
        setFlash(true);
        setTimeout(() => setFlash(false), 2500);
      }),
    []
  );
  const offline = access.kind === "offlineTooLong";
  return (
    <View style={[styles.banner, flash && styles.bannerFlash]} pointerEvents="box-none">
      <Ionicons name={offline ? "cloud-offline-outline" : "lock-closed-outline"} size={16} color="#FFFFFF" />
      <Text style={styles.bannerText}>
        {flash
          ? "That wasn't saved: Fia is read-only."
          : offline
            ? `Fia couldn't check your access for ${OFFLINE_GRACE_DAYS} days. Connect to the internet to keep saving.`
            : "Your access to Fia has ended. You can still view and export your data."}
      </Text>
      {offline && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.bannerAction}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    blank: { flex: 1, backgroundColor: colors.background },
    signInPage: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing.md },
    signInCard: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      alignItems: "center",
      gap: spacing.sm,
    },
    logo: { width: 88, height: 88, borderRadius: 22, marginBottom: spacing.xs },
    title: { fontSize: 24, fontWeight: "800", color: colors.textPrimary, textAlign: "center" },
    subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
    points: { alignSelf: "stretch", gap: 8, marginVertical: spacing.sm },
    point: { flexDirection: "row", alignItems: "center", gap: 10 },
    pointText: { fontSize: 14, color: colors.textPrimary },
    buttonWrap: { alignSelf: "stretch", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.xs },
    button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
    buttonText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
    footnote: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 17, marginTop: spacing.xs },
    link: { color: colors.accent, fontWeight: "700" },
    banner: {
      position: "absolute",
      left: spacing.md,
      right: spacing.md,
      bottom: 96,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "#334155",
      borderRadius: radius.chip,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
    },
    bannerFlash: { backgroundColor: "#B45309" },
    bannerText: { flex: 1, fontSize: 12, color: "#FFFFFF", lineHeight: 17, fontWeight: "600" },
    bannerAction: { fontSize: 12, fontWeight: "800", color: "#FFFFFF", textDecorationLine: "underline" },
  });
}
