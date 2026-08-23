import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text } from "react-native";
import { colors, gradientAccent, radius, spacing } from "../lib/theme";
import { PressScale } from "./PressScale";

export function PillButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  if (variant === "primary") {
    return (
      <PressScale
        onPress={onPress}
        disabled={disabled}
        style={[styles.base, styles.clip, disabled && styles.disabled]}
      >
        <LinearGradient
          colors={gradientAccent}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.primaryText}>{title}</Text>
      </PressScale>
    );
  }

  const style = variant === "danger" ? styles.danger : styles.secondary;
  const textStyle = variant === "danger" ? styles.dangerText : styles.secondaryText;

  return (
    <PressScale onPress={onPress} disabled={disabled} style={[styles.base, style, disabled && styles.disabled]}>
      <Text style={textStyle}>{title}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  clip: {
    overflow: "hidden",
  },
  secondary: {
    backgroundColor: colors.card,
  },
  danger: {
    backgroundColor: colors.negative,
  },
  disabled: {
    opacity: 0.4,
  },
  primaryText: {
    color: colors.pillActiveText,
    fontWeight: "600",
    fontSize: 15,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "600",
    fontSize: 15,
  },
  dangerText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
});
