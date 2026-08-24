import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PillButton } from "./PillButton";
import { colors, spacing } from "./../lib/theme";

type Props = { children: ReactNode };
type State = { error: Error | null };

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
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Couldn't load your data</Text>
          <Text style={styles.message}>
            This usually clears up with a reload. If it keeps happening, try opening this from
            your home-screen bookmark instead of a browser tab.
          </Text>
          <PillButton title="Reload" onPress={() => window.location.reload()} />
        </View>
      );
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
    gap: spacing.md,
    backgroundColor: colors.gradientStart,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, textAlign: "center" },
  message: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
});
