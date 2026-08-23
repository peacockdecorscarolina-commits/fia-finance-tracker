import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 4, paddingVertical: spacing.lg },
  icon: { fontSize: 32, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
});
