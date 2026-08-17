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
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        variant === "primary" ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>
        {title}
      </Text>
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
});
