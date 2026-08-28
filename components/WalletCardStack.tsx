import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { darken } from "../lib/color";
import { radius, spacing } from "../lib/theme";

const CARD_HEIGHT = 168;
const PEEK_HEIGHT = 44;

export type WalletCardItem = {
  key: string;
  name: string;
  subtitle: string;
  footerRight?: string;
  color: string;
};

// A stack of overlapping "wallet" cards -- the front card is fully visible,
// cards behind it peek out below and are progressively scaled/dimmed for
// depth. Tapping the front card fires onPressFront; tapping a card further
// back brings it to the front instead, mirroring how Apple Wallet's card
// stack behaves (no drag gestures needed, just tap-to-bring-forward).
export function WalletCardStack({
  items,
  onPressFront,
  onEdit,
}: {
  items: WalletCardItem[];
  onPressFront: (item: WalletCardItem) => void;
  onEdit?: (item: WalletCardItem) => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const posRefs = useRef<Record<string, Animated.Value>>({});

  useEffect(() => {
    setOrder((prev) => {
      const currentKeys = items.map((i) => i.key);
      const kept = prev.filter((k) => currentKeys.includes(k));
      const missing = currentKeys.filter((k) => !kept.includes(k));
      const next = [...kept, ...missing];
      const unchanged = prev.length === next.length && prev.every((k, i) => k === next[i]);
      return unchanged ? prev : next;
    });
  }, [items]);

  // Refs are created lazily right here (during render) rather than in an
  // effect -- an effect runs after commit and creating a ref doesn't itself
  // trigger a re-render, so the very first render after a new key appears
  // in `order` would find no ref yet and skip rendering that card entirely.
  order.forEach((key, i) => {
    if (!posRefs.current[key]) posRefs.current[key] = new Animated.Value(i);
  });

  useEffect(() => {
    order.forEach((key, i) => {
      Animated.spring(posRefs.current[key], { toValue: i, useNativeDriver: false, friction: 9, tension: 60 }).start();
    });
  }, [order]);

  function bringToFront(key: string) {
    setOrder((prev) => (prev[0] === key ? prev : [key, ...prev.filter((x) => x !== key)]));
  }

  function handlePress(item: WalletCardItem) {
    if (order[0] === item.key) {
      onPressFront(item);
    } else {
      bringToFront(item.key);
    }
  }

  if (items.length === 0) return null;

  return (
    <View style={{ height: CARD_HEIGHT + (items.length - 1) * PEEK_HEIGHT }}>
      {order.map((key, index) => {
        const item = items.find((i) => i.key === key);
        if (!item) return null;
        const pos = posRefs.current[key];
        if (!pos) return null;
        const isFront = order[0] === key;

        const top = pos.interpolate({ inputRange: [0, 1], outputRange: [0, PEEK_HEIGHT] });
        const scale = pos.interpolate({
          inputRange: [0, 1, 2, 3],
          outputRange: [1, 0.97, 0.94, 0.92],
          extrapolate: "clamp",
        });
        const opacity = pos.interpolate({
          inputRange: [0, 1, 2, 3],
          outputRange: [1, 0.92, 0.85, 0.78],
          extrapolate: "clamp",
        });

        return (
          <Animated.View
            key={key}
            style={[
              styles.cardWrap,
              { top, transform: [{ scale }], opacity, zIndex: items.length - index },
            ]}
          >
            <Pressable onPress={() => handlePress(item)}>
              <LinearGradient
                colors={[item.color, darken(item.color, 20)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.cardGlyphWrap}>
                    <Text style={styles.cardGlyph}>💳</Text>
                  </View>
                  {isFront && onEdit && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        onEdit(item);
                      }}
                      style={styles.cardEditBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="pencil" size={13} color="#FFFFFF" />
                    </Pressable>
                  )}
                </View>
                <View style={{ flex: 1 }} />
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.cardBottomRow}>
                  <Text style={styles.cardType} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                  {item.footerRight && <Text style={styles.cardSpend}>{item.footerRight}</Text>}
                </View>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: { position: "absolute", left: 0, right: 0 },
  card: {
    height: CARD_HEIGHT,
    borderRadius: radius.card,
    padding: spacing.md,
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardGlyphWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#FFFFFF33",
    alignItems: "center",
    justifyContent: "center",
  },
  cardGlyph: { fontSize: 16 },
  cardEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF33",
    alignItems: "center",
    justifyContent: "center",
  },
  cardName: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginBottom: 6 },
  cardBottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardType: { flex: 1, fontSize: 12, fontWeight: "600", color: "#FFFFFFCC" },
  cardSpend: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
});
