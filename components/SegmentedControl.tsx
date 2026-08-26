import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

const GRADIENT = ["#4C1D95", "#312E81"] as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      {options.map((option) => {
        const active = option === value;
        if (active) {
          return (
            <Pressable key={option} onPress={() => onChange(option)} style={styles.segmentWrap}>
              <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.segment}>
                <Text style={[styles.label, styles.labelActive]}>{option}</Text>
              </LinearGradient>
            </Pressable>
          );
        }
        return (
          <Pressable key={option} onPress={() => onChange(option)} style={[styles.segmentWrap, styles.segment]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: radius.pill,
    padding: 4,
  },
  segmentWrap: {
    flex: 1,
  },
  segment: {
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  labelActive: {
    color: "#FFFFFF",
  },
});
