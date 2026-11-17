import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { spacing } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

// The browser lets one copy of Fia at a time open the database file. A second
// copy -- another tab, or the app reopened before the old copy has finished
// closing -- fails with NoModificationAllowedError, and after that the
// database engine in that page is stuck ("Invalid VFS state") until the page
// reloads. So a locked database is retried by reloading the page.
export function isDatabaseLocked(error: Error | null): boolean {
  return !!error && /NoModificationAllowed|createSyncAccessHandle|Access Handle|Invalid VFS state|database is locked|SQLITE_BUSY/i.test(`${error.name} ${error.message}`);
}

// Reloads while waiting for the other copy to let go: up to this many, over
// about half a minute, before showing the error.
const LOCK_RELOADS = 8;
const LOCK_WINDOW_MS = 60_000;
const RELOAD_KEY = "fia_db_reloads";
const RETRY_MS = [600, 1000, 1500, 2000];
// Anything else gets one quiet retry, without reloading.
const OTHER_RETRIES = 1;

function readReloads(): { count: number; since: number } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || "null");
    if (saved && Date.now() - saved.since < LOCK_WINDOW_MS) return saved;
  } catch {
    // Unreadable: start over.
  }
  return { count: 0, since: Date.now() };
}

// Called once the database opens: the next problem starts a fresh count.
export function clearDatabaseReloads() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

function canReloadForLock(): boolean {
  return Platform.OS === "web" && readReloads().count < LOCK_RELOADS;
}

type Props = { children: ReactNode };
type State = { error: Error | null; attempts: number };

function retryDelay(attempts: number): number {
  return RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)];
}

function willRetry(state: State): boolean {
  if (!state.error) return false;
  if (isDatabaseLocked(state.error)) return canReloadForLock();
  return state.attempts < OTHER_RETRIES;
}

// A function component so it can read the current theme -- the class below
// can't use hooks itself (needs getDerivedStateFromError).
function Opening({ locked }: { locked: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color="#4C1D95" />
      <Text style={[styles.title, { color: colors.textPrimary }]}>Opening your data...</Text>
      {locked && (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Waiting for Fia to finish closing in another tab or window.
        </Text>
      )}
    </View>
  );
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { colors } = useTheme();
  const locked = isDatabaseLocked(error);
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.iconWrap}>
        <Ionicons name={locked ? "copy-outline" : "cloud-offline-outline"} size={28} color="#4C1D95" />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{locked ? "Fia is open somewhere else" : "Couldn't load your data"}</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {locked
          ? "Your data can only be open in one place at a time. Close Fia in any other tab or window, then tap Reload."
          : Platform.OS === "web"
            ? "This usually clears up with a reload. If it keeps happening, try opening this from your home-screen bookmark instead of a browser tab."
            : "This usually clears up by trying again. If it keeps happening, try closing and reopening the app."}
      </Text>
      <Pressable
        onPress={() => {
          if (Platform.OS === "web") {
            window.location.reload();
          } else {
            onRetry();
          }
        }}
        style={styles.reloadBtnWrap}
      >
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.reloadBtn}>
          <Text style={styles.reloadBtnText}>{Platform.OS === "web" ? "Reload" : "Try Again"}</Text>
        </LinearGradient>
      </Pressable>
      {/* So a screenshot says what actually went wrong. */}
      <Text style={[styles.details, { color: colors.textSecondary }]} numberOfLines={3}>
        Details: {error.name}: {error.message}
      </Text>
    </View>
  );
}

// Catches errors from opening the local database (and anything else that
// breaks a screen), so a failure shows something with a way out instead of a
// blank white screen (the August 2026 incident). A locked database is retried
// quietly for a while first, since it usually frees up by itself.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempts: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      localStorage.setItem(
        "fia_last_error",
        JSON.stringify({ at: new Date().toISOString(), name: error.name, message: error.message.slice(0, 500), where: info.componentStack?.slice(0, 300) })
      );
    } catch {
      // Storage unavailable: nothing to keep.
    }
  }

  componentDidUpdate() {
    if (this.timer || !willRetry(this.state)) return;
    if (isDatabaseLocked(this.state.error)) {
      const reloads = readReloads();
      this.timer = setTimeout(() => {
        try {
          sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ count: reloads.count + 1, since: reloads.since }));
        } catch {
          // Without storage there's no count, so don't risk reloading forever.
          return;
        }
        window.location.reload();
      }, retryDelay(reloads.count));
      return;
    }
    // Anything else: remounting the children tries again from scratch.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState((s) => ({ error: null, attempts: s.attempts + 1 }));
    }, retryDelay(this.state.attempts));
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error && willRetry(this.state)) return <Opening locked={isDatabaseLocked(error)} />;
    if (error) return <ErrorFallback error={error} onRetry={this.handleRetry} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  message: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  details: { fontSize: 11, textAlign: "center", lineHeight: 15, marginTop: spacing.sm, opacity: 0.8 },
  reloadBtnWrap: { borderRadius: 999, overflow: "hidden", marginTop: spacing.sm, alignSelf: "stretch" },
  reloadBtn: { paddingVertical: 14, alignItems: "center" },
  reloadBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
