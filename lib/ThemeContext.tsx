import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Every redesigned screen defines the same five tokens locally (background,
// card, textPrimary, textSecondary, border) -- category/status colors
// (accent purple, danger red, positive green, category tints) stay fixed
// across modes since saturated colors already read fine on both light and
// dark surfaces, same as most native apps' dark modes. Only these five
// "page chrome" tokens actually need to invert.
export type ThemeMode = "light" | "dark";

export type ThemeColors = {
  background: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
};

const LIGHT: ThemeColors = {
  background: "#F2F2F7",
  card: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  border: "#E5E5EA",
};

const DARK: ThemeColors = {
  background: "#000000",
  card: "#1C1C1E",
  textPrimary: "#F2F2F7",
  textSecondary: "#9CA3AF",
  border: "#2C2C2E",
};

const STORAGE_KEY = "fia-theme-mode";

function getInitialMode(): ThemeMode {
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

type ThemeContextValue = { mode: ThemeMode; colors: ThemeColors; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore -- the preference just won't persist this session.
    }
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
