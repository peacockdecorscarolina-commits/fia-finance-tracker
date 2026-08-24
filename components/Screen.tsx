import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useRef, type ReactNode } from "react";
import { SafeAreaView, StyleSheet, type GestureResponderEvent } from "react-native";
import { colors } from "../lib/theme";

// Edge-swipe-to-go-back, the way iOS lets you swipe in from the left edge
// of any pushed screen. react-native-screens' native swipe gesture doesn't
// carry over to the web build, so this re-creates it with plain touch
// events instead of pulling in react-native-gesture-handler for one gesture.
const EDGE_ZONE = 24;
const SWIPE_THRESHOLD = 80;

// Native RN flattens the first touch's coords onto nativeEvent.pageX/pageY;
// the web build's nativeEvent is a raw DOM TouchEvent, which only has them
// nested under touches[0]/changedTouches[0]. Read whichever shape is there.
function touchCoords(e: GestureResponderEvent): { x: number; y: number } | null {
  const ne = e.nativeEvent as unknown as {
    pageX?: number;
    pageY?: number;
    touches?: { pageX: number; pageY: number }[];
    changedTouches?: { pageX: number; pageY: number }[];
  };
  if (typeof ne.pageX === "number" && typeof ne.pageY === "number") {
    return { x: ne.pageX, y: ne.pageY };
  }
  const touch = ne.touches?.[0] ?? ne.changedTouches?.[0];
  return touch ? { x: touch.pageX, y: touch.pageY } : null;
}

export function Screen({ children }: { children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: GestureResponderEvent) {
    const coords = touchCoords(e);
    start.current = coords && coords.x <= EDGE_ZONE ? coords : null;
  }

  function onTouchEnd(e: GestureResponderEvent) {
    if (!start.current) return;
    const coords = touchCoords(e);
    const origin = start.current;
    start.current = null;
    if (!coords) return;
    const dx = coords.x - origin.x;
    const dy = Math.abs(coords.y - origin.y);
    if (dx > SWIPE_THRESHOLD && dy < SWIPE_THRESHOLD && router.canGoBack()) {
      router.back();
    }
  }

  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      style={StyleSheet.absoluteFill}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <SafeAreaView style={styles.safeArea}>{children}</SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
