import type { ReactNode } from "react";
import { useRef } from "react";
import { Animated, Pressable, type StyleProp, type ViewStyle } from "react-native";

// Wraps any pressable in a subtle scale-down-on-tap animation, so buttons
// and chips feel like they respond to touch instead of just flatly
// switching state on release.
export function PressScale({
  children,
  onPress,
  disabled,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  function animateTo(value: number) {
    Animated.spring(scale, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => animateTo(0.96)}
      onPressOut={() => animateTo(1)}
      style={style}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
