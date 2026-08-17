import { StyleSheet, Text } from "react-native";
import { colors } from "../lib/theme";

export function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function AmountText({ amount, size = "md" }: { amount: number; size?: "sm" | "md" | "lg" }) {
  const isNegative = amount < 0;
  return (
    <Text
      style={[
        styles.base,
        size === "sm" && styles.sm,
        size === "lg" && styles.lg,
        { color: isNegative ? colors.negative : colors.positive },
      ]}
    >
      {formatAmount(amount)}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 16,
    fontWeight: "600",
  },
  sm: {
    fontSize: 14,
  },
  lg: {
    fontSize: 28,
    fontWeight: "700",
  },
});
