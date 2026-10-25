import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useMemo, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "./EmptyState";
import { Greeting } from "./Greeting";
import { SegmentedControl } from "./SegmentedControl";
import { SyncButton } from "./SyncButton";
import { getAccountCardColor } from "../lib/accountStyle";
import { darken } from "../lib/color";
import { getCategoryStyle } from "../lib/categoryStyle";
import { formatMerchantName } from "../lib/formatMerchant";
import {
  getAccountBalances,
  getAccounts,
  getAccountSummary,
  getAssetSummaries,
  getAssetTypeHistory,
  getCategorySummary,
  getNeedsReviewCount,
  getPaymentTotal,
  getTransactionMonthBounds,
  getTransactions,
  type AccountTotal,
  type CategoryTotal,
} from "../lib/db";
import { periodRange } from "../lib/period";
import { radius, spacing, tabBarClearance } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";
import { ASSET_TYPES, type Account, type AssetType, type Transaction } from "../lib/types";

const NET_WORTH_ICON: Record<AssetType, string> = { Savings: "💰", Investment: "📈", "401k": "🏦", Cash: "💵", Home: "🏡" };
const NET_WORTH_TINT: Record<AssetType, string> = {
  Savings: "#EDE9FE",
  Investment: "#DCFCE7",
  "401k": "#DBEAFE",
  Cash: "#FEF3C7",
  Home: "#FFEDD5",
};

const HERO_GRADIENT = ["#4C1D95", "#312E81"] as const;

const VIEWS = ["Month", "Year"] as const;
type SummaryView = (typeof VIEWS)[number];

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Every month from `newest` back to `oldest`, inclusive -- gaps included, so a
// month with no statement yet is still reachable.
function monthsBetween(newest: string, oldest: string): string[] {
  const list: string[] = [];
  for (let m = newest; m >= oldest; m = shiftMonth(m, -1)) list.push(m);
  return list;
}

const DONUT_SIZE = 140;
const DONUT_HOLE_SIZE = 92;

function Donut({ slices, total }: { slices: { name: string; value: number; color: string }[]; total: number }) {
  const { colors } = useTheme();
  const donutStyles = useMemo(() => makeDonutStyles(colors), [colors]);
  const [selected, setSelected] = useState<number | null>(null);
  let cumulative = 0;
  const stops = slices.map((s) => {
    const startPct = (cumulative / total) * 100;
    cumulative += s.value;
    const endPct = (cumulative / total) * 100;
    return { ...s, startPct, endPct };
  });
  const gradient = `conic-gradient(${stops.map((s) => `${s.color} ${s.startPct}% ${s.endPct}%`).join(", ")})`;

  // The donut is a single CSS conic-gradient, not discrete SVG wedges, so
  // figuring out which slice was tapped means converting the tap position
  // into an angle ourselves: measure clockwise from the top (12 o'clock) to
  // match how conic-gradient lays out its 0%/100% stops, then match that
  // against each slice's [startPct, endPct) range.
  function handlePress(e: {
    nativeEvent: { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
  }) {
    // Web-only: RN Web's synthetic locationX/locationY isn't reliably
    // element-relative, but the underlying DOM MouseEvent's offsetX/offsetY
    // is exactly that -- position relative to this Pressable's own box.
    const locationX = e.nativeEvent.offsetX ?? e.nativeEvent.locationX ?? 0;
    const locationY = e.nativeEvent.offsetY ?? e.nativeEvent.locationY ?? 0;
    const center = DONUT_SIZE / 2;
    const dx = locationX - center;
    const dy = locationY - center;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < DONUT_HOLE_SIZE / 2 || distance > DONUT_SIZE / 2) {
      setSelected(null);
      return;
    }
    const angleFromEast = (Math.atan2(dy, dx) * 180) / Math.PI;
    const angleFromNorth = ((angleFromEast + 90) % 360 + 360) % 360;
    const pct = (angleFromNorth / 360) * 100;
    const index = stops.findIndex((s) => pct >= s.startPct && pct < s.endPct);
    setSelected((current) => (current === index ? null : index));
  }

  const active = selected !== null ? stops[selected] : null;

  return (
    <Pressable onPress={handlePress} style={[donutStyles.donut, { backgroundImage: gradient } as object]}>
      <View style={donutStyles.donutHole}>
        <Text style={donutStyles.donutValue}>{formatMoney(active ? active.value : total)}</Text>
        <Text style={donutStyles.donutLabel} numberOfLines={1}>
          {active ? active.name : "Total"}
        </Text>
      </View>
    </Pressable>
  );
}

function makeDonutStyles(colors: ThemeColors) {
  return StyleSheet.create({
    donut: {
      width: DONUT_SIZE,
      height: DONUT_SIZE,
      borderRadius: DONUT_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    donutHole: {
      width: DONUT_HOLE_SIZE,
      height: DONUT_HOLE_SIZE,
      borderRadius: DONUT_HOLE_SIZE / 2,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    donutValue: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    donutLabel: { fontSize: 11, color: colors.textSecondary, textAlign: "center" },
  });
}

type MoreItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };

function MoreSheet({
  visible,
  onClose,
  items,
  title = "More tools",
}: {
  visible: boolean;
  onClose: () => void;
  items: MoreItem[];
  title?: string;
}) {
  const { colors } = useTheme();
  const sheetStyles = useMemo(() => makeSheetStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.sheetBackdrop} onPress={onClose}>
        <Pressable style={sheetStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={sheetStyles.sheetHandle} />
          <Text style={sheetStyles.sheetTitle}>{title}</Text>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={sheetStyles.sheetRow}
            >
              <View style={sheetStyles.sheetIconWrap}>
                <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
              </View>
              <Text style={sheetStyles.sheetRowLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeSheetStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBackdrop: { flex: 1, backgroundColor: "#00000055", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: spacing.md,
      gap: spacing.xs,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: spacing.sm,
    },
    sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetRowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  });
}

// The Summary and Accounts tabs: one screen sharing the header and period
// picker, showing spending (total, by category, last transactions) or where
// the money sits (savings & investments, by account) for that period.
export function PeriodOverview({ section }: { section: "spending" | "accounts" }) {
  const { colors, mode, toggle: toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [month, setMonth] = useState<string | null>(null);
  // Year view reuses `month` -- it shows that month's whole year, so flipping
  // back to Month lands where you were.
  const [view, setView] = useState<SummaryView>("Month");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [monthBounds, setMonthBounds] = useState<{ first: string; last: string } | null>(null);
  const pickerScrollRef = useRef<ScrollView>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [accountTotals, setAccountTotals] = useState<AccountTotal[]>([]);
  const [accountBalances, setAccountBalances] = useState<Record<number, number>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prevTotal, setPrevTotal] = useState(0);
  const [paymentTotal, setPaymentTotal] = useState(0);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<{ id: number; name: string; type: AssetType; balance: number }[]>([]);
  const [assetHistories, setAssetHistories] = useState<Record<AssetType, { date: string; total: number }[]>>(
    {} as Record<AssetType, { date: string; total: number }[]>
  );

  useFocusEffect(
    useCallback(() => {
      getNeedsReviewCount(db).then(setReviewCount);
      getTransactionMonthBounds(db).then(setMonthBounds);
      getAssetSummaries(db).then(setAssets);
      Promise.all(ASSET_TYPES.map((type) => getAssetTypeHistory(db, type).then((history) => [type, history] as const))).then(
        (entries) => setAssetHistories(Object.fromEntries(entries) as Record<AssetType, { date: string; total: number }[]>)
      );
      if (month === null) {
        setMonth(currentMonth());
        return;
      }
      setLoading(true);
      // The summary queries match dates by prefix, so a bare "YYYY" covers the whole year.
      const key = view === "Year" ? month.slice(0, 4) : month;
      const prevKey = view === "Year" ? String(Number(key) - 1) : shiftMonth(month, -1);
      const { start, end } = periodRange(key);
      Promise.all([
        getCategorySummary(db, key).then(setCategoryTotals),
        getAccountSummary(db, key).then(setAccountTotals),
        getCategorySummary(db, prevKey).then((rows) => setPrevTotal(rows.reduce((sum, r) => sum + r.total, 0))),
        getPaymentTotal(db, key).then(setPaymentTotal),
        getTransactions(db, { start, end }).then((list) => setRecent(list.slice(0, 5))),
        getAccounts(db).then(setAccounts),
        getAccountBalances(db, end).then(setAccountBalances),
      ]).then(() => setLoading(false));
    }, [db, month, view])
  );

  if (month === null) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const total = categoryTotals.reduce((sum, c) => sum + c.total, 0);
  const pctChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
  const year = month.slice(0, 4);
  const periodKey = view === "Year" ? year : month;
  const periodWord = view === "Year" ? "this year" : "this month";
  // A year still in progress against a full previous year would always read
  // as a big drop, so the change is only shown once the year is over.
  const showDelta = prevTotal > 0 && (view === "Month" || year < currentMonth().slice(0, 4));
  const remaining = Math.max(total - paymentTotal, 0);

  // The current month is always offered, even before any statement covers it,
  // and so is the selected one. String compare works since months are "YYYY-MM".
  const pickerEdges = [currentMonth(), month, ...(monthBounds ? [monthBounds.first, monthBounds.last] : [])].sort();
  const pickerMonths = monthsBetween(pickerEdges[pickerEdges.length - 1], pickerEdges[0]);
  const pickerYears = [...new Set(pickerMonths.map((m) => m.slice(0, 4)))];

  const moreItems: MoreItem[] = [
    { icon: "search-outline", label: "Search", onPress: () => router.push({ pathname: "/all-transactions", params: { search: "1" } }) },
    { icon: "card-outline", label: "Manage accounts", onPress: () => router.push("/accounts") },
    { icon: "pricetag-outline", label: "Categories", onPress: () => router.push("/categories") },
    { icon: "trending-up-outline", label: "Savings & Investments", onPress: () => router.push("/net-worth") },
    { icon: "swap-horizontal-outline", label: "Move", onPress: () => router.push("/move-transactions") },
    { icon: "git-compare-outline", label: "Find Transfers", onPress: () => router.push("/find-transfers") },
    { icon: "trash-outline", label: "Delete", onPress: () => router.push("/delete-transactions") },
    ...(Platform.OS === "web"
      ? [
          { icon: "cloud-outline" as const, label: "Sync", onPress: () => router.push("/sync") },
          {
            icon: "refresh-outline" as const,
            label: "Refresh App",
            onPress: () => {
              window.location.href = `${window.location.pathname}?refreshed=${Date.now()}`;
            },
          },
        ]
      : []),
  ];

  const addItems: MoreItem[] = [
    { icon: "create-outline", label: "Add transaction", onPress: () => router.push("/add-transaction") },
    { icon: "cloud-upload-outline", label: "Upload statement", onPress: () => router.push("/upload") },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Greeting />
          <View style={styles.headerIcons}>
            <Pressable onPress={toggleTheme} style={styles.headerIconBtn}>
              <Ionicons name={mode === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.textPrimary} />
            </Pressable>
            <SyncButton style={styles.headerIconBtn} />
            <Pressable onPress={() => setMoreOpen(true)} style={styles.headerIconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />
            </Pressable>
            <Pressable onPress={() => router.push("/review")} style={styles.headerIconBtn}>
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
              {reviewCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeCount}>{reviewCount > 9 ? "9+" : reviewCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <SegmentedControl options={VIEWS} value={view} onChange={setView} />

        <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.monthPill}>
          <Text style={styles.monthPillText}>📅 {view === "Year" ? year : formatMonthLabel(month)}</Text>
          <Text style={styles.monthPillChevron}>{pickerOpen ? "▲" : "▼"}</Text>
        </Pressable>

        {pickerOpen && (
          <ScrollView ref={pickerScrollRef} style={styles.monthDropdown} nestedScrollEnabled>
            {view === "Year"
              ? pickerYears.map((y) => (
                  <Pressable
                    key={y}
                    style={[styles.monthOption, y === year && styles.monthOptionActive]}
                    onPress={() => {
                      // Same month-of-year in the picked year, capped at the newest month offered.
                      const target = `${y}-${month.slice(5)}`;
                      setMonth(target > pickerMonths[0] ? pickerMonths[0] : target);
                      setPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.monthOptionText, y === year && styles.monthOptionTextActive]}>{y}</Text>
                  </Pressable>
                ))
              : pickerMonths.map((m, i) => (
                  <View
                    key={m}
                    // Opens scrolled to the month being viewed, with a little of
                    // the months around it showing.
                    onLayout={
                      m === month
                        ? (e) => pickerScrollRef.current?.scrollTo({ y: Math.max(e.nativeEvent.layout.y - 80, 0), animated: false })
                        : undefined
                    }
                  >
                    {(i === 0 || pickerMonths[i - 1].slice(0, 4) !== m.slice(0, 4)) && (
                      <Text style={styles.monthYearHeader}>{m.slice(0, 4)}</Text>
                    )}
                    <Pressable
                      style={[styles.monthOption, m === month && styles.monthOptionActive]}
                      onPress={() => {
                        setMonth(m);
                        setPickerOpen(false);
                      }}
                    >
                      <Text style={[styles.monthOptionText, m === month && styles.monthOptionTextActive]}>
                        {formatMonthLabel(m)}
                      </Text>
                    </Pressable>
                  </View>
                ))}
          </ScrollView>
        )}

        {section === "spending" && (
        <LinearGradient colors={HERO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroLabel}>Total spent</Text>
              <Text style={styles.heroValue}>{formatMoney(total)}</Text>
              {showDelta && (
                <Text style={[styles.heroDelta, { color: pctChange <= 0 ? "#86EFAC" : "#FCA5A5" }]}>
                  {pctChange <= 0 ? "▼" : "▲"} {Math.abs(pctChange).toFixed(1)}% from last {view === "Year" ? "year" : "month"}
                </Text>
              )}
            </View>
            <View style={styles.heroDivider} />
            <View>
              <Text style={styles.heroLabel}>Total paid</Text>
              <Text style={styles.heroValueSm}>{formatMoney(paymentTotal)}</Text>
            </View>
          </View>
          <View style={styles.heroBottomRow}>
            <View>
              <Text style={styles.heroLabel}>Remaining to pay</Text>
              <Text style={styles.heroValueSm}>{formatMoney(remaining)}</Text>
            </View>
            <View style={styles.heroIcon}>
              <Text style={{ fontSize: 20 }}>💳</Text>
            </View>
          </View>
        </LinearGradient>
        )}

        {section === "accounts" && (
          <View style={{ gap: spacing.md }}>
            <Text style={[styles.stackTitle, { marginBottom: 0 }]}>Savings & Investments</Text>
            {assets.length === 0 && (
              <Pressable style={styles.assetCard} onPress={() => router.push("/net-worth")}>
                <View style={[styles.assetCardIcon, { backgroundColor: NET_WORTH_TINT.Savings }]}>
                  <Text style={{ fontSize: 16 }}>➕</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.assetCardValue}>Add savings & investments</Text>
                  <Text style={styles.assetCardLabel}>Savings, investments, 401k, cash or your home</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
            {ASSET_TYPES.filter((type) => assets.some((a) => a.type === type)).map((type) => {
              const history = assetHistories[type] ?? [];
              const totalForType = assets.filter((a) => a.type === type).reduce((sum, a) => sum + a.balance, 0);
              const first = history[0]?.total ?? totalForType;
              const delta = totalForType - first;
              const pct = first !== 0 ? (delta / first) * 100 : 0;
              return (
                <Pressable key={type} style={styles.assetCard} onPress={() => router.push("/net-worth")}>
                  <View style={[styles.assetCardIcon, { backgroundColor: NET_WORTH_TINT[type] }]}>
                    <Text style={{ fontSize: 16 }}>{NET_WORTH_ICON[type]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assetCardLabel}>{type}</Text>
                    <Text style={styles.assetCardValue}>{formatMoney(totalForType)}</Text>
                  </View>
                  {history.length >= 2 && (
                    <Text style={[styles.assetCardDelta, { color: delta >= 0 ? "#16A34A" : "#DC2626" }]}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        )}

        {section === "accounts" && (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.stackTitleRow}>
            <Text style={[styles.stackTitle, { marginBottom: 0 }]}>By account</Text>
            <Pressable onPress={() => router.push("/accounts")}>
              <Text style={styles.stackTitleLink}>Manage</Text>
            </Pressable>
          </View>
          {loading ? null : accountTotals.length === 0 ? (
            <View style={styles.sectionCard}>
              <EmptyState icon="📊" title="Nothing here yet" subtitle={`No spending recorded on any card ${periodWord}.`} />
            </View>
          ) : (
            accountTotals.map((a) => {
              const share = total > 0 ? (a.total / total) * 100 : 0;
              const account = accounts.find((acc) => acc.name === a.accountName);
              const balance = account ? accountBalances[account.id] : undefined;
              const color = getAccountCardColor(a.accountName, accounts);
              const initials = a.accountName
                .split(/\s+/)
                .map((w) => w[0])
                .join("")
                .slice(0, 3)
                .toUpperCase();
              return (
                <Pressable
                  key={a.accountName}
                  onPress={() => router.push({ pathname: "/account/[name]", params: { name: a.accountName, month } })}
                >
                  <LinearGradient
                    colors={[color, darken(color, 40)]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.accountRow}
                  >
                    <View style={styles.accountBadge}>
                      <Text style={styles.accountBadgeText}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accountRowName} numberOfLines={1}>
                        {a.accountName}
                      </Text>
                      <Text style={styles.accountRowSub}>{share.toFixed(1)}% of spend</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.accountRowAmount}>
                        {balance !== undefined ? formatMoney(balance) : formatMoney(a.total)}
                      </Text>
                      <Text style={styles.accountRowSub}>
                        {balance !== undefined ? `balance as of ${periodKey}` : periodWord}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                  </LinearGradient>
                </Pressable>
              );
            })
          )}
        </View>
        )}

        {section === "spending" && (
        <View>
          <Text style={styles.stackTitle}>By category</Text>
          <View style={styles.sectionCard}>
            {loading ? null : categoryTotals.length === 0 ? (
              <EmptyState icon="📊" title="Nothing here yet" subtitle={`No spending recorded ${periodWord}.`} />
            ) : (
              <View style={styles.categoryRow}>
                <Donut
                  total={total}
                  slices={categoryTotals.map((c) => ({
                    name: c.categoryName,
                    value: c.total,
                    color: getCategoryStyle(c.categoryName).color,
                  }))}
                />
                <View style={styles.legend}>
                  {categoryTotals.map((c) => {
                    const style = getCategoryStyle(c.categoryName);
                    const pct = total > 0 ? (c.total / total) * 100 : 0;
                    return (
                      <Pressable
                        key={c.categoryName}
                        style={styles.legendRow}
                        onPress={() =>
                          router.push({ pathname: "/category/[name]", params: { name: c.categoryName, month: periodKey } })
                        }
                      >
                        <View style={[styles.legendDot, { backgroundColor: style.color }]} />
                        <Text style={styles.legendName} numberOfLines={1}>
                          {style.emoji} {c.categoryName}
                        </Text>
                        <Text style={styles.legendPct}>{pct.toFixed(1)}%</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        </View>
        )}

        {section === "spending" && (
        <View>
          <Text style={styles.stackTitle}>Last transactions</Text>
          <View style={styles.sectionCard}>
            {loading ? null : recent.length === 0 ? (
              <EmptyState icon="🧾" title="Nothing here yet" subtitle={`No transactions recorded ${periodWord}.`} />
            ) : (
              recent.map((t) => {
                const style = getCategoryStyle(t.categoryName);
                return (
                  <View key={t.id} style={styles.txRow}>
                    <View style={[styles.txIcon, { backgroundColor: style.color }]}>
                      <Text style={{ fontSize: 16 }}>{style.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txName}>{formatMerchantName(t.merchant)}</Text>
                      <Text style={styles.txMeta}>{t.date}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.txAmount}>{formatMoney(Math.abs(t.amount))}</Text>
                      <Text style={styles.txCategory}>{t.categoryName}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <MoreSheet visible={addOpen} onClose={() => setAddOpen(false)} items={addItems} title="Add" />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
    paddingBottom: tabBarClearance,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerIcons: { flexDirection: "row", gap: spacing.sm },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  notifBadgeCount: { fontSize: 9, fontWeight: "700", color: "#FFFFFF" },
  monthPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  monthPillText: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  monthPillChevron: { fontSize: 9, color: colors.textSecondary },
  monthDropdown: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.xs,
    gap: 2,
    maxHeight: 260,
    overflow: "hidden",
  },
  monthOption: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.chip },
  monthOptionActive: { backgroundColor: colors.background },
  monthYearHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  monthOptionText: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  monthOptionTextActive: { fontWeight: "700" },
  hero: { borderRadius: radius.card, padding: spacing.md, gap: spacing.md },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start" },
  heroDivider: { width: 1, backgroundColor: "#FFFFFF33", marginHorizontal: spacing.md, alignSelf: "stretch" },
  heroLabel: { fontSize: 12, color: "#FFFFFFCC", fontWeight: "600" },
  heroValue: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", marginTop: 2 },
  heroValueSm: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginTop: 2 },
  heroDelta: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  heroBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF1A",
    borderRadius: radius.chip,
    padding: spacing.sm,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF26",
    alignItems: "center",
    justifyContent: "center",
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  assetCardIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  assetCardLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  assetCardValue: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginTop: 2 },
  assetCardDelta: { fontSize: 12, fontWeight: "600" },
  sectionCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  stackTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  stackTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stackTitleLink: { fontSize: 13, fontWeight: "600", color: colors.accent },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  accountBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  accountBadgeText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  accountRowName: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  accountRowSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  accountRowAmount: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: "600" },
  legendPct: { fontSize: 12, color: colors.textSecondary, fontWeight: "700" },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  txMeta: { fontSize: 12, color: colors.textSecondary },
  txAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  txCategory: { fontSize: 11, color: colors.textSecondary },
  fab: {
    position: "absolute",
    right: spacing.md,
    bottom: tabBarClearance - spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4C1D95",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  });
}
