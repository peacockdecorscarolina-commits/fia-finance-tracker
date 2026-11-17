import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Component, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { spacing } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const GRADIENT = ["#4C1D95", "#312E81"] as const;

type Props = { children: ReactNode };
type State = { error: Error | null };

// A function component so it can read the current theme -- the class below
// can't use hooks itself (needs getDerivedStateFromError).
function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.iconWrap}>
        <Ionicons name="refresh-outline" size={28} color="#4C1D95" />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Close Fia and open it again</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        Fia couldn't open your data this time. Your data is safe. Close the app completely (on iPhone, swipe it away from your
        recent apps), then open it again.
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
          <Text style={styles.reloadBtnText}>Try again</Text>
        </LinearGradient>
      </Pressable>
      {/* So a screenshot says what actually went wrong. */}
      <Text style={[styles.details, { color: colors.textSecondary }]} numberOfLines={2}>
        Details: {error.name}: {error.message}
      </Text>
    </View>
  );
}

// Catches errors from opening the local database (and anything else that
// breaks a screen), so a failure shows something with a way out instead of a
// blank white screen (the August 2026 incident).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
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
  details: { fontSize: 11, textAlign: "center", lineHeight: 15, marginTop: spacing.sm, opacity: 0.8 },
  reloadBtnWrap: { borderRadius: 999, overflow: "hidden", marginTop: spacing.sm, alignSelf: "stretch" },
  reloadBtn: { paddingVertical: 14, alignItems: "center" },
  reloadBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
