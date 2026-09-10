"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import PaidSessionSplash from "../components/paid-session-splash";
import AppearanceRuntime from "../lib/branding/appearance-runtime";
import { pathnameUsesAppShell } from "../lib/nav/product-route";

const AppShell = dynamic(() => import("../components/app-shell"), { ssr: true });

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

function readCookiePreference(): ThemePreference | null {
  try {
    const pref = document.cookie.match(/(?:^|; )vantage-theme-pref=(light|dark|system)/);
    if (pref) return pref[1] as ThemePreference;
    const legacy = document.cookie.match(/(?:^|; )vantage-theme=(light|dark)/);
    if (legacy) return legacy[1] as ThemePreference;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * The preference this browser has actually chosen, or `null` when it has never
 * chosen one. The distinction matters: "no preference yet" must never be
 * written back as if it were a choice — see the ThemeProvider effect below.
 */
function storedPreference(): ThemePreference | null {
  try {
    const pref = localStorage.getItem(PREF_STORAGE_KEY);
    if (pref === "light" || pref === "dark" || pref === "system") return pref;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    /* ignore */
  }
  // The inline bootstrap in layout.tsx paints from the COOKIE, so ignoring it
  // here meant a browser with a cookie but no localStorage (a fresh profile, a
  // second device, private browsing) rendered dark and then flipped to light on
  // hydration. Same source of truth, same answer.
  return readCookiePreference();
}

/** Same lookup, collapsed to what the UI should render when nothing is stored. */
function readStoredPreference(): ThemePreference {
  return storedPreference() ?? "light";
}

/** Keep the OS browser chrome on the same colour as --bg. */
function syncBrowserColor(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => { meta.content = theme === "dark" ? "#0c1118" : "#eef2f7"; });
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
  const productRoute = pathnameUsesAppShell(pathname);

  useEffect(() => {
    if (!productRoute) return;
    let cancelled = false;
    const markReady = () => document.documentElement.classList.add("theme-ready");

    // `null` means this browser has never picked a theme. Anything we write for
    // it would be the *default*, not a choice.
    const localPref = storedPreference();
    if (localPref === "system") {
      applyPreference("system");
      markReady();
      return;
    }

    /**
     * Settle on one preference and write it at most once.
     *
     * Two things used to go wrong here, both because the non-persisted branch
     * called applyPreference() unconditionally:
     *
     *  1. With nothing stored, `localPref` fell back to "light" and we stamped
     *     `vantage-theme-pref=light` into the cookie. The boot script reads the
     *     cookie *ahead of* localStorage, so that fabricated default then
     *     outranked a real dark choice on the next boot — a preference the user
     *     never made, permanently masking the one they did.
     *  2. `localPref` is a beat old by the time the request lands. Choosing a
     *     theme from Account → Appearance while /api/theme was in flight got
     *     stomped back to the pre-request value.
     *
     * So: re-read at settle time, let an in-flight choice win over the server's
     * copy, and when neither side has a preference write nothing at all — the
     * boot script has already painted the default.
     */
    const settle = (serverPref: ThemePreference | null) => {
      if (cancelled) return;
      const latest = storedPreference();
      const chosenInFlight = latest !== localPref ? latest : null;
      const next = chosenInFlight ?? serverPref ?? localPref;
      if (next) applyPreference(next);
      // No preference anywhere: leave storage untouched and only bring the OS
      // browser chrome in line with whatever the boot script already painted.
      else syncBrowserColor(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
      markReady();
    };

    void fetch("/api/theme")
      .then(async (response) => response.ok ? response.json() as Promise<{ theme?: Theme; persisted?: boolean }> : null)
      .then((result) => {
        const persisted = result?.persisted && (result.theme === "light" || result.theme === "dark")
          ? result.theme
          : null;
        settle(persisted);
      })
      .catch(() => settle(null));

    return () => { cancelled = true; };
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
