import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "theme-preference";

function getStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? getSystemTheme() : pref;
}

function applyTheme(pref: ThemePreference) {
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);

  useEffect(() => {
    applyTheme(preference);
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // Re-apply when system theme changes while in "system" mode
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  const cycleTheme = () => {
    setPreference((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  };

  return { preference, resolvedTheme: resolveTheme(preference), cycleTheme };
}
