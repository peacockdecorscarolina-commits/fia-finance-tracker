import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { colors } from "../lib/theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      style={StyleSheet.absoluteFill}
    >
      <SafeAreaView style={styles.safeArea}>{children}</SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
