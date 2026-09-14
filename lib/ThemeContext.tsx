import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Every redesigned screen defines the same tokens locally (background,
// card, textPrimary, textSecondary, border, accent) -- danger red,
// positive green, and category tints stay fixed across modes since those
// saturated colors already read fine on both light and dark surfaces,
// same as most native apps' dark modes. `accent` is the one exception:
// the brand purple (#4C1D95) is dark enough that it goes low-contrast as
// text/icons directly on a black background, so it brightens in dark mode.
// Note: `accent` here is only for standalone icons/links/text sitting
// directly on the page's card/background. It's NOT used for the
// "selected tile" pattern (light lavender chip + dark purple label) --
// that pairing is self-contained and intentionally stays fixed in both
// modes using each screen's local ACCENT/ACCENT_LIGHT constants.
export type ThemeMode = "light" | "dark";

export type ThemeColors = {
  background: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
};

const LIGHT: ThemeColors = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
  accent: "#4C1D95",
};

const DARK: ThemeColors = {
  background: "#000000",
  card: "#1C1C1E",
  textPrimary: "#F2F2F7",
  textSecondary: "#9CA3AF",
  border: "#2C2C2E",
  accent: "#A78BFA",
};

const STORAGE_KEY = "fia-theme-mode";

// Web: localStorage/matchMedia let us read the saved preference (and the
// system's dark-mode setting) synchronously, so the first paint is already
// correct with no flash of the wrong theme. Native has no synchronous
// storage API, so getInitialMode() there just returns the system's current
// appearance as a best guess, and ThemeProvider corrects it from AsyncStorage
// once that resolves (see the effect below).
function getInitialMode(): ThemeMode {
  if (Platform.OS === "web") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // localStorage can throw in private-browsing contexts -- fall through.
    }
    try {
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
    } catch {
      // matchMedia can be unavailable in some embedded webviews.
    }
    return "light";
  }
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

type ThemeContextValue = { mode: ThemeMode; colors: ThemeColors; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);

  // Native-only: once AsyncStorage resolves, override the initial
  // system-appearance guess with the user's last explicit choice, if any.
  useEffect(() => {
    if (Platform.OS === "web") return;
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark") setMode(stored);
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      try {
        window.localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Ignore -- the preference just won't persist this session.
      }
      return;
    }
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {
      // Ignore -- the preference just won't persist this session.
    });
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors: mode === "dark" ? DARK : LIGHT,
      toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")),
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
