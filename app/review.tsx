import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../components/EmptyState";
import { formatAmount } from "../components/AmountText";
import { getCategoryStyle } from "../lib/categoryStyle";
import { formatMerchantName } from "../lib/formatMerchant";
import {
  getCategories,
  getNeedsReview,
  ignoreAndResolveReview,
  normalizeMerchantKey,
  setMerchantCategory,
} from "../lib/db";
import { radius, spacing } from "../lib/theme";
import type { Category, Transaction } from "../lib/types";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

// Matches the rest of the app's redesigned screens.
const ACCENT = "#4C1D95";
const IGNORE_COLOR = "#DC2626";
const SKIP_COLOR = "#D97706";
const TAG_COLOR = "#16A34A";

const SWIPE_X_THRESHOLD = 90;
const SWIPE_Y_THRESHOLD = 70;
const FLY_DISTANCE = 560;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function ReviewScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(() => {
    getNeedsReview(db).then((rows) => {
      setQueue(rows);
      setTotalCount(rows.length);
      setResolvedCount(0);
    });
    getCategories(db).then(setCategories);
  }, [db]);

  useFocusEffect(load);

  function removeResolved(ids: Set<number>) {
    setQueue((q) => q.filter((t) => !ids.has(t.id)));
    setResolvedCount((n) => n + ids.size);
  }

  async function handleTag(categoryId: number) {
    const front = queue[0];
    if (!front) return;
    await setMerchantCategory(db, front.merchant, categoryId);
    // setMerchantCategory resolves every transaction sharing this merchant's
    // key, not just the front one -- drop all of them from the local queue
    // too, or an already-tagged duplicate would still surface later in the
    // same stack.
    const key = normalizeMerchantKey(front.merchant);
    const matchedIds = new Set(queue.filter((t) => normalizeMerchantKey(t.merchant) === key).map((t) => t.id));
    removeResolved(matchedIds);
  }

  async function handleIgnore() {
    const front = queue[0];
    if (!front) return;
    await ignoreAndResolveReview(db, front.id);
    removeResolved(new Set([front.id]));
  }

  function handleSkip() {
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Review</Text>
          <View style={styles.headerBtn} />
        </View>

        {totalCount > 0 && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(resolvedCount / totalCount) * 100}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {Math.min(resolvedCount + 1, totalCount)} / {totalCount}
            </Text>
          </View>
        )}

        <Text style={styles.subtitle}>
          Tap a category to tag it (applies to this merchant from now on) — or swipe: left to ignore, up to skip
          for later.
        </Text>

        <View style={styles.stackWrap}>
          {queue.length === 0 ? (
            <EmptyState icon="✅" title="All caught up" subtitle="Nothing needs review right now." />
          ) : (
            queue.slice(0, 3).map((t, i) =>
              i === 0 ? (
                <ReviewCard
                  key={t.id}
                  transaction={t}
                  categories={categories}
                  styles={styles}
                  onTag={handleTag}
                  onIgnore={handleIgnore}
                  onSkip={handleSkip}
                />
              ) : (
                <PeekCard key={t.id} transaction={t} depth={i} styles={styles} />
              )
            )
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function PeekCard({
  transaction,
  depth,
  styles,
}: {
  transaction: Transaction;
  depth: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const style = getCategoryStyle(transaction.categoryName);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.card,
        styles.peekCard,
        {
          transform: [{ translateY: depth * 10 }, { scale: 1 - depth * 0.035 }],
          opacity: depth === 2 ? 0.5 : 0.85,
          zIndex: 10 - depth,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: hexToRgba(style.color, 0.14) }]}>
          <Text style={styles.avatarEmoji}>{style.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant} numberOfLines={1}>
            {formatMerchantName(transaction.merchant)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ReviewCard({
  transaction,
  categories,
  styles,
  onTag,
  onIgnore,
  onSkip,
}: {
  transaction: Transaction;
  categories: Category[];
  styles: ReturnType<typeof makeStyles>;
  onTag: (categoryId: number) => void;
  onIgnore: () => void;
  onSkip: () => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;

  function flyOff(toX: number, toY: number, after: () => void) {
    Animated.timing(pan, { toValue: { x: toX, y: toY }, duration: 170, useNativeDriver: false }).start(() => after());
  }

  function settleBack() {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, speed: 20, bounciness: 6 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        const vertical = Math.abs(gesture.dy) > Math.abs(gesture.dx);
        if (vertical && gesture.dy < -SWIPE_Y_THRESHOLD) {
          flyOff(0, -FLY_DISTANCE, onSkip);
        } else if (!vertical && gesture.dx < -SWIPE_X_THRESHOLD) {
          flyOff(-FLY_DISTANCE, 40, onIgnore);
        } else {
          settleBack();
        }
      },
      onPanResponderTerminate: settleBack,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ).current;

  const rotate = pan.x.interpolate({ inputRange: [-240, 0, 240], outputRange: ["-16deg", "0deg", "16deg"] });
  const ignoreOpacity = pan.x.interpolate({ inputRange: [-SWIPE_X_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const skipOpacity = pan.y.interpolate({ inputRange: [-SWIPE_Y_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });

  const style = getCategoryStyle(transaction.categoryName);
  const isNegative = transaction.amount < 0;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.card,
        { zIndex: 20, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
      ]}
    >
      <Animated.View style={[styles.stamp, styles.stampIgnore, { opacity: ignoreOpacity }]}>
        <Text style={styles.stampIgnoreText}>Ignore</Text>
      </Animated.View>
      <Animated.View style={[styles.stamp, styles.stampSkip, { opacity: skipOpacity }]}>
        <Text style={styles.stampSkipText}>Skip</Text>
      </Animated.View>

      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: hexToRgba(style.color, 0.14) }]}>
          <Text style={styles.avatarEmoji}>{style.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant} numberOfLines={2}>
            {formatMerchantName(transaction.merchant)}
          </Text>
          <Text style={styles.meta}>
            {transaction.date} · {transaction.accountName}
          </Text>
        </View>
        <Text style={[styles.amount, { color: isNegative ? IGNORE_COLOR : TAG_COLOR }]}>
          {formatAmount(transaction.amount)}
        </Text>
      </View>

      <View style={styles.chips}>
        {categories.map((c) => {
          const cs = getCategoryStyle(c.name);
          return (
            <Pressable key={c.id} onPress={() => flyOff(FLY_DISTANCE, 40, () => onTag(c.id))} style={styles.chipBtn}>
              <Text style={styles.chipEmoji}>{cs.emoji}</Text>
              <Text style={styles.chipName} numberOfLines={1}>
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actionsRow}>
        <Pressable onPress={() => flyOff(-FLY_DISTANCE, 40, onIgnore)} style={styles.actionBtn}>
          <Ionicons name="eye-off-outline" size={14} color={IGNORE_COLOR} />
          <Text style={[styles.actionBtnText, { color: IGNORE_COLOR }]}>Ignore</Text>
        </Pressable>
        <Pressable onPress={() => flyOff(0, -FLY_DISTANCE, onSkip)} style={styles.actionBtn}>
          <Ionicons name="arrow-redo-outline" size={14} color={SKIP_COLOR} />
          <Text style={[styles.actionBtnText, { color: SKIP_COLOR }]}>Skip for now</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
    headerBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
    progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
    progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: ACCENT, borderRadius: 3 },
    progressLabel: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
    subtitle: { fontSize: 12.5, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 17 },
    stackWrap: { flex: 1, position: "relative" },
    card: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
    },
    peekCard: { justifyContent: "flex-start" },
    cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    avatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    avatarEmoji: { fontSize: 20 },
    merchant: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    amount: { fontSize: 15, fontWeight: "800" },
    stamp: {
      position: "absolute",
      top: spacing.md,
      borderWidth: 3,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 4,
      zIndex: 30,
    },
    stampIgnore: { left: spacing.md, borderColor: IGNORE_COLOR, transform: [{ rotate: "-12deg" }] },
    stampIgnoreText: { color: IGNORE_COLOR, fontWeight: "800", fontSize: 15, textTransform: "uppercase" },
    stampSkip: { alignSelf: "center", left: "38%", borderColor: SKIP_COLOR },
    stampSkipText: { color: SKIP_COLOR, fontWeight: "800", fontSize: 15, textTransform: "uppercase" },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    chipBtn: {
      flexBasis: "30%",
      flexGrow: 1,
      alignItems: "center",
      gap: 4,
      paddingVertical: spacing.sm,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    chipEmoji: { fontSize: 18 },
    chipName: { fontSize: 10.5, fontWeight: "700", color: colors.textSecondary },
    actionsRow: {
      flexDirection: "row",
      gap: spacing.md,
      marginTop: "auto",
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      justifyContent: "center",
    },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
    actionBtnText: { fontSize: 12.5, fontWeight: "700" },
  });
}
