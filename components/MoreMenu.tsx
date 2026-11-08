import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { cachedEmail, requestAccessCheck } from "../lib/access";
import { lastDriveSync } from "../lib/autoBackup";
import { checkInMonth, checkInStreak, statementsDone } from "../lib/checkIn";
import {
  getAccounts,
  getCheckInsDone,
  getFlaggedCount,
  getNeedsReviewCount,
  getRecurring,
  getSetting,
  getStatementStatuses,
  getTransactions,
  getUserName,
  setSetting,
  todayISO,
} from "../lib/db";
import { downloadCsv, transactionsToCsv } from "../lib/exportCsv";
import { signOut } from "../lib/googleAuth";
import {
  backupBadge,
  countBadge,
  MENU_LAYOUT_KEY,
  MENU_LAYOUTS,
  parseMenuLayout,
  type BadgeTone,
  type MenuBadge,
  type MenuLayout,
} from "../lib/moreMenu";
import { radius, spacing } from "../lib/theme";
import { useTheme, type ThemeColors } from "../lib/ThemeContext";

const ACCENT = "#4C1D95";
const DANGER = "#DC2626";
const CHECK_IN_STEPS = 3;

// Pill colors stay fixed across light and dark, like the app's other chips.
const SOFT: Record<BadgeTone, { bg: string; fg: string }> = {
  purple: { bg: "#EDE9FE", fg: "#4C1D95" },
  amber: { bg: "#FEF3C7", fg: "#92400E" },
  neutral: { bg: "#E8E6EF", fg: "#3F3B52" },
  green: { bg: "#DCFCE7", fg: "#166534" },
  red: { bg: "#FEE2E2", fg: "#B91C1C" },
};
const SOLID: Record<BadgeTone, string> = {
  purple: "#4C1D95",
  amber: "#B45309",
  neutral: "#5B5670",
  green: "#15803D",
  red: "#B91C1C",
};

type Item = {
  key: string;
  label: string;
  // The grid's shorter name.
  short: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  badge?: MenuBadge | null;
  danger?: boolean;
  // Its own light color (the Track items): the tile or grid cell's
  // background and the icon's color, the same in light and dark.
  tint?: { bg: string; fg: string };
};

const TINT = {
  purple: { bg: "#EDE9FE", fg: "#4C1D95" },
  yellow: { bg: "#FEF3C7", fg: "#92400E" },
  blue: { bg: "#E0F2FE", fg: "#075985" },
  green: { bg: "#DCFCE7", fg: "#166534" },
};
// Text on a tinted background stays dark in dark mode too.
const ON_TINT = "#1E1B2E";

type Section = { title: string; items: Item[] };

type Stats = {
  name: string | null;
  email: string | null;
  streak: number;
  checkIn: MenuBadge | null;
  watch: MenuBadge | null;
  subscriptions: MenuBadge | null;
  accounts: MenuBadge | null;
  backup: MenuBadge;
};

async function loadStats(db: ReturnType<typeof useSQLiteContext>): Promise<Stats> {
  const today = todayISO();
  const month = checkInMonth(today);
  const [name, email, doneMonths, statuses, reviewCount, flagged, recurring, accounts, lastSync] = await Promise.all([
    getUserName(db),
    cachedEmail(db),
    getCheckInsDone(db),
    getStatementStatuses(db, today),
    getNeedsReviewCount(db),
    getFlaggedCount(db),
    getRecurring(db),
    getAccounts(db),
    lastDriveSync(db),
  ]);
  // Same steps as Home's check-in card; none until something's uploaded.
  let checkIn: MenuBadge | null = null;
  if (statuses.some((s) => s.nextExpected !== null)) {
    if (doneMonths.includes(month)) checkIn = { text: "Done", short: "✓", tone: "green" };
    else {
      const done = (statementsDone(statuses, month) ? 1 : 0) + (reviewCount === 0 ? 1 : 0);
      checkIn = { text: `${done} of ${CHECK_IN_STEPS}`, short: `${done}/${CHECK_IN_STEPS}`, tone: "purple" };
    }
  }
  const watch = flagged > 0 ? { text: `${flagged} found`, short: String(flagged), tone: "amber" as const } : null;
  return {
    name,
    email,
    streak: checkInStreak(doneMonths, month),
    checkIn,
    watch,
    subscriptions: countBadge(recurring.filter((r) => !r.isStopped).length),
    accounts: countBadge(accounts.length),
    backup: backupBadge(lastSync),
  };
}

// The ⋯ menu, shared by Home and Summary. Three layouts -- a grouped list,
// big tiles over a list, or an icon grid -- switched at the top and
// remembered on this device.
export function MoreMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const db = useSQLiteContext();
  const [layout, setLayout] = useState<MenuLayout | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getSetting(db, MENU_LAYOUT_KEY).then((v) => setLayout(parseMenuLayout(v)));
  }, [db]);

  // Fresh counts each time it opens.
  useEffect(() => {
    if (visible) loadStats(db).then(setStats).catch(() => {});
  }, [visible, db]);

  function chooseLayout(next: MenuLayout) {
    setLayout(next);
    setSetting(db, MENU_LAYOUT_KEY, next).catch(() => {});
  }

  const go = (path: Parameters<typeof router.push>[0]) => () => router.push(path);
  const web = Platform.OS === "web";

  const sections: Section[] = [
    {
      title: "Track",
      items: [
        { key: "checkin", label: "Monthly check-in", short: "Check-in", icon: "calendar-outline", onPress: go("/check-in"), badge: stats?.checkIn, tint: TINT.purple },
        { key: "watch", label: "Watch list", short: "Watch list", icon: "eye-outline", onPress: go("/watch-list"), badge: stats?.watch, tint: TINT.yellow },
        { key: "search", label: "Search", short: "Search", icon: "search-outline", onPress: go({ pathname: "/all-transactions", params: { search: "1" } }), tint: TINT.blue },
        { key: "subs", label: "Subscriptions", short: "Subscriptions", icon: "repeat-outline", onPress: go("/subscriptions"), badge: stats?.subscriptions, tint: TINT.green },
      ],
    },
    {
      title: "Manage",
      items: [
        { key: "accounts", label: "Accounts", short: "Accounts", icon: "card-outline", onPress: go("/accounts"), badge: stats?.accounts },
        { key: "categories", label: "Categories", short: "Categories", icon: "pricetag-outline", onPress: go("/categories") },
        { key: "income", label: "Income", short: "Income", icon: "cash-outline", onPress: go("/income") },
        { key: "savings", label: "Savings & Investments", short: "Savings", icon: "trending-up-outline", onPress: go("/net-worth") },
      ],
    },
    {
      title: "Fix data",
      items: [
        { key: "transfers", label: "Find Transfers", short: "Transfers", icon: "git-compare-outline", onPress: go("/find-transfers") },
        { key: "move", label: "Move transactions", short: "Move", icon: "swap-horizontal-outline", onPress: go("/move-transactions") },
        { key: "delete", label: "Delete transactions", short: "Delete", icon: "trash-outline", onPress: go("/delete-transactions"), danger: true },
      ],
    },
    {
      title: "App",
      items: [
        { key: "backup", label: "Backup & sync", short: "Backup", icon: "cloud-outline", onPress: go("/sync"), badge: stats?.backup },
        ...(web
          ? [
              {
                key: "export",
                label: "Export CSV",
                short: "Export",
                icon: "download-outline" as const,
                onPress: async () => {
                  const all = await getTransactions(db);
                  downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactionsToCsv(all));
                },
              },
            ]
          : []),
        { key: "feedback", label: "Send feedback", short: "Feedback", icon: "chatbubble-ellipses-outline", onPress: go({ pathname: "/feedback", params: { from: "Menu" } }) },
        { key: "privacy", label: "Privacy", short: "Privacy", icon: "lock-closed-outline", onPress: go("/privacy") },
        ...(web
          ? [
              {
                key: "refresh",
                label: "Refresh app",
                short: "Refresh",
                icon: "refresh-outline" as const,
                onPress: () => {
                  window.location.href = `${window.location.pathname}?refreshed=${Date.now()}`;
                },
              },
            ]
          : []),
      ],
    },
  ];

  const press = (item: Item) => () => {
    onClose();
    item.onPress();
  };

  function handleSignOut() {
    onClose();
    signOut();
    requestAccessCheck();
  }

  const name = stats?.name?.trim() || "Your account";
  const sub = [stats?.email, stats && stats.streak > 0 ? `${stats.streak}-month streak` : null].filter(Boolean).join(" · ");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>More</Text>
            <View style={styles.switcher} accessibilityRole="tablist">
              {MENU_LAYOUTS.map((l) => {
                const on = layout === l.value;
                return (
                  <Pressable
                    key={l.value}
                    onPress={() => chooseLayout(l.value)}
                    style={[styles.switchBtn, on && styles.switchBtnOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.switchText, on && styles.switchTextOn]}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.account}>
              <View style={styles.avatar}>
                {stats?.name?.trim() ? (
                  <Text style={styles.avatarText}>{stats.name.trim()[0].toUpperCase()}</Text>
                ) : (
                  <Ionicons name="person" size={18} color="#FFFFFF" />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.accountName} numberOfLines={1}>
                  {name}
                </Text>
                {!!sub && (
                  <Text style={styles.accountSub} numberOfLines={1}>
                    {sub}
                  </Text>
                )}
              </View>
              {web && (
                <Pressable onPress={handleSignOut} style={styles.signOut}>
                  <Text style={styles.signOutText}>Sign out</Text>
                </Pressable>
              )}
            </View>

            {layout === "list" && sections.map((s) => <ListSection key={s.title} section={s} press={press} styles={styles} colors={colors} />)}

            {layout === "tiles" && (
              <>
                <View style={styles.tiles}>
                  {sections[0].items.map((item) => (
                    <Pressable key={item.key} onPress={press(item)} style={[styles.tile, item.tint && { backgroundColor: item.tint.bg }]}>
                      <View style={[styles.tileIcon, item.tint && { backgroundColor: "#FFFFFF" }]}>
                        <Ionicons name={item.icon} size={20} color={item.tint?.fg ?? colors.accent} />
                      </View>
                      <Text style={[styles.tileLabel, item.tint && { color: ON_TINT }]} numberOfLines={1}>
                        {item.short}
                      </Text>
                      {item.badge && item.tint ? (
                        <Text style={[styles.tileSub, { color: item.tint.fg }]} numberOfLines={1}>
                          {item.key === "subs" ? `${item.badge.text} active` : item.badge.text}
                        </Text>
                      ) : item.badge ? (
                        <Pill badge={item.badge} styles={styles} />
                      ) : (
                        <View style={{ height: 18 }} />
                      )}
                    </Pressable>
                  ))}
                </View>
                {sections.slice(1).map((s) => (
                  <ListSection key={s.title} section={s} press={press} styles={styles} colors={colors} />
                ))}
              </>
            )}

            {layout === "grid" &&
              sections.map((s) => (
                <View key={s.title} style={{ gap: 6 }}>
                  <Text style={styles.sectionTitle}>{s.title}</Text>
                  <View style={styles.grid}>
                    {s.items.map((item) => (
                      <Pressable
                        key={item.key}
                        onPress={press(item)}
                        style={[styles.cell, item.tint && { backgroundColor: item.tint.bg }]}
                        accessibilityLabel={item.label}
                      >
                        <Ionicons name={item.icon} size={22} color={item.danger ? DANGER : item.tint?.fg ?? colors.accent} />
                        <Text style={[styles.cellLabel, item.tint && { color: ON_TINT }]} numberOfLines={1}>
                          {item.short}
                        </Text>
                        {item.badge && (
                          <View style={[styles.corner, { backgroundColor: SOLID[item.badge.tone] }]}>
                            <Text style={styles.cornerText}>{item.badge.short}</Text>
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ListSection({
  section,
  press,
  styles,
  colors,
}: {
  section: Section;
  press: (item: Item) => () => void;
  styles: Styles;
  colors: ThemeColors;
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <View style={styles.group}>
        {section.items.map((item, i) => (
          <Pressable key={item.key} onPress={press(item)} style={[styles.row, i > 0 && styles.rowDivider]}>
            {item.tint ? (
              <View style={[styles.rowBubble, { backgroundColor: item.tint.bg }]}>
                <Ionicons name={item.icon} size={17} color={item.tint.fg} />
              </View>
            ) : (
              <Ionicons name={item.icon} size={20} color={item.danger ? DANGER : colors.accent} />
            )}
            <Text style={[styles.rowLabel, item.danger && { color: DANGER }]} numberOfLines={1}>
              {item.label}
            </Text>
            {item.badge && <Pill badge={item.badge} styles={styles} />}
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Pill({ badge, styles }: { badge: MenuBadge; styles: Styles }) {
  const c = SOFT[badge.tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]} numberOfLines={1}>
        {badge.text}
      </Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      paddingTop: spacing.sm,
      maxHeight: "90%",
      width: "100%",
      maxWidth: 560,
      alignSelf: "center",
    },
    handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.sm },
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, gap: spacing.sm },
    title: { fontSize: 20, fontWeight: "800", color: colors.textPrimary },
    switcher: { flexDirection: "row", backgroundColor: colors.background, borderRadius: radius.pill, padding: 3 },
    switchBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    switchBtnOn: { backgroundColor: ACCENT },
    switchText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
    switchTextOn: { color: "#FFFFFF" },
    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    account: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.chip, backgroundColor: colors.background },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 17, fontWeight: "800", color: "#FFFFFF" },
    accountName: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    accountSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    signOut: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    signOutText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.textSecondary, marginLeft: 4, marginBottom: 4 },
    group: { borderRadius: radius.chip, backgroundColor: colors.background, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, minHeight: 48 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: "500", color: colors.textPrimary },
    pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 150 },
    pillText: { fontSize: 12, fontWeight: "700" },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: { width: "48%", flexGrow: 1, minHeight: 104, borderRadius: 18, padding: 14, gap: 8, backgroundColor: colors.background, alignItems: "flex-start" },
    tileIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    tileLabel: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
    tileSub: { fontSize: 12, fontWeight: "700", height: 18 },
    rowBubble: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: -5, marginRight: -5 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    cell: {
      width: "23%",
      flexGrow: 0,
      minHeight: 78,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 2,
      gap: 6,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    cellLabel: { fontSize: 11, fontWeight: "600", color: colors.textPrimary, textAlign: "center" },
    corner: {
      position: "absolute",
      top: 4,
      right: 4,
      minWidth: 20,
      height: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    cornerText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF" },
  });
}
