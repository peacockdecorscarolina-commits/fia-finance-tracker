import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../lib/theme";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.container}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: colors.pillActive,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.pillInactiveText,
  },
  labelActive: {
    color: colors.pillActiveText,
  },
});
