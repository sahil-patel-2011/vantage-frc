"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "../components/app-shell";
import PaidSessionSplash from "../components/paid-session-splash";
import AppearanceRuntime from "../lib/branding/appearance-runtime";

/** Resolved color scheme applied to the document. */
export type Theme = "light" | "dark";

/** User preference — System follows prefers-color-scheme. */
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "vantage-theme";
const PREF_STORAGE_KEY = "vantage-theme-pref";

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(pref: ThemePreference): Theme {
  return pref === "system" ? systemTheme() : pref;
}

function readStoredPreference(): ThemePreference {
  try {
    const pref = localStorage.getItem(PREF_STORAGE_KEY);
    if (pref === "light" || pref === "dark" || pref === "system") return pref;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    /* ignore */
  }
  return "light";
}

function syncBrowserColor(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => { meta.content = theme === "dark" ? "#0b1014" : "#f7f6f2"; });
}

function applyResolvedTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  syncBrowserColor(theme);
  localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `vantage-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent("vantage-theme", { detail: theme }));
}

function applyPreference(pref: ThemePreference) {
  localStorage.setItem(PREF_STORAGE_KEY, pref);
  document.cookie = `vantage-theme-pref=${pref}; Path=/; Max-Age=31536000; SameSite=Lax`;
  applyResolvedTheme(resolveTheme(pref));
}

export function ThemeToggle({ expanded = false }: { expanded?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>("light");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const pref = readStoredPreference();
    setPreference(pref);
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    syncBrowserColor(current);

    const syncTheme = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    const syncPref = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next === "light" || next === "dark" || next === "system") setPreference(next);
    };
    window.addEventListener("vantage-theme", syncTheme);
    window.addEventListener("vantage-theme-pref", syncPref);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (readStoredPreference() === "system") applyResolvedTheme(systemTheme());
    };
    mq.addEventListener("change", onSystem);

    return () => {
      window.removeEventListener("vantage-theme", syncTheme);
      window.removeEventListener("vantage-theme-pref", syncPref);
      mq.removeEventListener("change", onSystem);
    };
  }, []);

  async function choose(next: ThemePreference) {
    setPreference(next);
    applyPreference(next);
    window.dispatchEvent(new CustomEvent("vantage-theme-pref", { detail: next }));
    if (next === "system") return;
    try {
      await fetch("/api/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
    } catch {
      // Local persistence remains authoritative when auth/database is unavailable.
    }
  }

  if (expanded) {
    return (
      <fieldset className="theme-setting">
        <legend>Appearance</legend>
        <p>Choose Light, Dark, or System (follows your device). Change lives in Account settings — not the top bar.</p>
        <div role="radiogroup" aria-label="Color theme">
          {(["light", "dark", "system"] as const).map((option) => (
            <button
              aria-checked={preference === option}
              className={preference === option ? "active" : ""}
              key={option}
              onClick={() => void choose(option)}
              role="radio"
              type="button"
            >
              <span aria-hidden="true">{option === "light" ? "☀" : option === "dark" ? "☾" : "◐"}</span>
              {option === "light" ? "Light" : option === "dark" ? "Dark" : "System"}
              {option === "system" ? <small>Now {theme}</small> : null}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  // Compact toggle kept for rare embeds — product chrome uses Account → Appearance.
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => void choose(theme === "light" ? "dark" : "light")}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
      <span>{theme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const productRoute = !["/", "/features", "/features/cad", "/features/strategy", "/features/code", "/workflow", "/desktop", "/for-teams", "/pricing", "/privacy", "/terms", "/signin", "/sign-in", "/offline"].includes(pathname)
    && !pathname.startsWith("/display/kiosk")
    && !pathname.startsWith("/display/pit")
    && !pathname.startsWith("/showcase/present")
    // Public sponsor storefront stays shell-free; /support tickets use the Soft-UI app chrome.
    && !/^\/support\/[^/]+/.test(pathname);

  useEffect(() => {
    if (!productRoute) return;
    const localPref = readStoredPreference();
    if (localPref === "system") {
      applyPreference("system");
      document.documentElement.classList.add("theme-ready");
      return;
    }
    void fetch("/api/theme")
      .then(async (response) => response.ok ? response.json() as Promise<{ theme?: Theme; persisted?: boolean }> : null)
      .then((result) => {
        if (result?.persisted && (result.theme === "light" || result.theme === "dark")) {
          applyPreference(result.theme);
          setTimeout(() => document.documentElement.classList.add("theme-ready"), 0);
        } else {
          applyPreference(localPref);
          document.documentElement.classList.add("theme-ready");
        }
      })
      .catch(() => {
        applyPreference(localPref);
        document.documentElement.classList.add("theme-ready");
      });
  }, [productRoute]);

  return (
    <>
      {/* Team accent + personal density/motion, applied on <html> next to the theme. */}
      {productRoute && <AppearanceRuntime />}
      {/* Before the content, because AppShell renders the "Skip to main content"
          link. After the content it was the last thing in the tab order — you
          had to tab through the whole page to reach the link that skips it. The
          shell is fixed-position with explicit z-index, so source order does not
          change what paints on top. */}
      {productRoute && <AppShell />}
      <div id="main-content">{children}</div>
      {productRoute && <PaidSessionSplash />}
    </>
  );
}
