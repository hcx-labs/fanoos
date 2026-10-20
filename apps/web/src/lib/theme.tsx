import { storageKey } from "./brand";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "system";

type ThemeContextValue = { theme: Theme; resolved: "dark" | "light"; setTheme: (theme: Theme) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const KEY = storageKey("theme");

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch {}
  return "dark";
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read);
  const [system, setSystem] = useState(systemDark);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystem(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const resolved = theme === "system" ? (system ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  useEffect(() => {
    window.fanoosDesktop?.setTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
