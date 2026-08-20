import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing } from "../lib/theme";

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
  const style = variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : styles.secondary;
  const textStyle =
    variant === "primary" ? styles.primaryText : variant === "danger" ? styles.dangerText : styles.secondaryText;

  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.base, style, disabled && styles.disabled]}>
      <Text style={textStyle}>{title}</Text>
    </Pressable>
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
  primary: {
    backgroundColor: colors.pillActive,
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
