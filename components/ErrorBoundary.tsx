import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spacing } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

type Props = { children: ReactNode };
type State = { error: Error | null };

// A function component so it can read the current theme -- the class below
// can't use hooks itself (needs getDerivedStateFromError).
function ErrorFallback() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.iconWrap}>
        <Ionicons name="cloud-offline-outline" size={28} color="#4C1D95" />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Couldn't load your data</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        This usually clears up with a reload. If it keeps happening, try opening this from your
        home-screen bookmark instead of a browser tab.
      </Text>
      <Pressable onPress={() => window.location.reload()} style={styles.reloadBtnWrap}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.reloadBtn}>
          <Text style={styles.reloadBtnText}>Reload</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// Catches errors from initializing the local database (expo-sqlite's web
// backend is still experimental on Safari and can fail there -- see the
// August 2026 incident where this failed silently as a blank white screen).
// Without this, a failure here just unmounts to nothing with no way to
// retry or even tell it happened.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback />;
    }
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
  reloadBtnWrap: { borderRadius: 999, overflow: "hidden", marginTop: spacing.sm, alignSelf: "stretch" },
  reloadBtn: { paddingVertical: 14, alignItems: "center" },
  reloadBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
