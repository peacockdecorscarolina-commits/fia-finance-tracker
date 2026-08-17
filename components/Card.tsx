import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { radius, spacing } from "../lib/theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={styles.shadowWrap}>
      <View style={styles.clip}>
        <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
        <View style={[styles.content, style]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    borderRadius: radius.card,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  clip: {
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FFFFFF66",
  },
  content: {
    padding: spacing.md,
  },
});
