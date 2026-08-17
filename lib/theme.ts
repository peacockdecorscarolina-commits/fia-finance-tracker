// Shared style tokens, based on the soft blue/mint + black-pill visual
// language from the reference designs (pro1/pro2/pro3.png).
export const colors = {
  gradientStart: "#EAF6F5",
  gradientEnd: "#DCEBF7",
  card: "#FFFFFFCC",
  cardSolid: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  positive: "#16A34A",
  positiveBg: "#DCFCE7",
  negative: "#DC2626",
  negativeBg: "#FEE2E2",
  pillActive: "#0F172A",
  pillActiveText: "#FFFFFF",
  pillInactiveText: "#334155",
  accent: "#3B82F6",
  accentBg: "#EFF6FF",
  statBg: "#D9ECFB",
};

export const radius = {
  card: 22,
  pill: 999,
  chip: 12,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Extra bottom clearance for scrollable content on tab screens, since the
// tab bar is absolutely positioned (required for its blur background).
export const tabBarClearance = 100;
