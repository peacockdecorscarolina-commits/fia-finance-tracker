import { StyleSheet, Text, View } from "react-native";
import { spacing } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 4, paddingVertical: spacing.lg },
  icon: { fontSize: 32, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: "700" },
  subtitle: { fontSize: 13, textAlign: "center" },
});
