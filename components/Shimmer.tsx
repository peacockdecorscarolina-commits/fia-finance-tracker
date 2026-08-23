import { useEffect, useRef } from "react";
import { Animated, Easing, type DimensionValue } from "react-native";

// A pulsing placeholder block, for showing where content will appear
// instead of a flash of "$0.00" while the first query is still in flight.
export function Shimmer({ width, height, borderRadius = 8 }: { width: DimensionValue; height: number; borderRadius?: number }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 550, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 550, easing: Easing.ease, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ width, height, borderRadius, backgroundColor: "#CBD5E1", opacity }} />;
}
