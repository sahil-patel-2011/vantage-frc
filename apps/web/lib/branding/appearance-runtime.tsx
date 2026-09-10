"use client";

import { useEffect } from "react";
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE_PREFS,
  appearanceAttributes,
  parseAppearancePrefs,
  type AppearancePrefs,
} from "./appearance";
import { accentIsActive, type OrgBrandingView } from "./branding";
import { ACCENT_VARIABLE_NAMES, LEGACY_ACCENT_ALIASES, accentCssVariables, buildAccentPlan } from "./colors";

/**
 * Applies the team accent and the member's appearance preferences to <html>.
 *
 * Mounted once by ThemeProvider on product routes, alongside the existing theme
 * bootstrap. Everything is applied as inline custom properties on the document
 * element so it wins over the token defaults in system.css without touching a
 * single existing rule, and so it survives client-side navigation.
 */

const CACHE_VERSION = 1;

type CachedBranding = {
  v: number;
  accentColor: string | null;
  applyAccent: boolean;
  appearance: AppearancePrefs;
};

/** Broadcast so Account → Appearance can repaint the whole app instantly. */
export const APPEARANCE_EVENT = "vantage-appearance";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyAccent(accentColor: string | null, enabled: boolean) {
  const root = document.documentElement;
  for (const name of LEGACY_ACCENT_ALIASES) root.style.removeProperty(name);
  const plan = enabled && accentColor ? buildAccentPlan(accentColor) : null;
  if (!plan) {
    for (const name of ACCENT_VARIABLE_NAMES) root.style.removeProperty(name);
    delete root.dataset.brandAccent;
    return;
  }
  const variables = accentCssVariables(plan, currentTheme());
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  root.dataset.brandAccent = plan.hex;
}

function applyPrefs(prefs: AppearancePrefs) {
  const root = document.documentElement;
  for (const [attribute, value] of Object.entries(appearanceAttributes(prefs))) {
    if (value === null) root.removeAttribute(attribute);
    else root.setAttribute(attribute, value);
  }
}

function readCache(): CachedBranding | null {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBranding>;
    if (parsed?.v !== CACHE_VERSION) return null;
    return {
      v: CACHE_VERSION,
      accentColor: typeof parsed.accentColor === "string" ? parsed.accentColor : null,
      applyAccent: parsed.applyAccent !== false,
      appearance: parseAppearancePrefs(parsed.appearance),
    };
  } catch {
    return null;
  }
}

function writeCache(next: CachedBranding) {
  try {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the server copy is still authoritative */
  }
}

/**
 * Applies a fresh set of values and caches them. Exported so the Appearance tab
 * and the Team branding panel can preview a change without a round trip.
 */
export function applyBranding(input: {
  org: Pick<OrgBrandingView, "accentColor" | "applyAccentToApp"> | null;
  appearance: AppearancePrefs;
  cache?: boolean;
}) {
  if (typeof document === "undefined") return;
  const enabled = accentIsActive(input.org, input.appearance);
  applyAccent(input.org?.accentColor ?? null, enabled);
  applyPrefs(input.appearance);
  if (input.cache !== false && typeof window !== "undefined") {
    writeCache({
      v: CACHE_VERSION,
      accentColor: input.org?.accentColor ?? null,
      applyAccent: input.org?.applyAccentToApp !== false,
      appearance: input.appearance,
    });
  }
}

/** Fire after saving so every mounted surface repaints from the new values. */
export function broadcastAppearance(detail: {
  org: Pick<OrgBrandingView, "accentColor" | "applyAccentToApp"> | null;
  appearance: AppearancePrefs;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail }));
}

export default function AppearanceRuntime() {
  useEffect(() => {
    let cancelled = false;
    let current: {
      org: Pick<OrgBrandingView, "accentColor" | "applyAccentToApp"> | null;
      appearance: AppearancePrefs;
    } = { org: null, appearance: { ...DEFAULT_APPEARANCE_PREFS } };

    // 1. Paint from the device cache immediately so a branded team does not see
    //    the stock blue flash on every navigation.
    const cached = readCache();
    if (cached) {
      current = {
        org: { accentColor: cached.accentColor, applyAccentToApp: cached.applyAccent },
        appearance: cached.appearance,
      };
      applyBranding({ ...current, cache: false });
    }

    // 2. Reconcile with the server. Failure leaves the cached paint in place.
    void fetch("/api/branding", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { org?: OrgBrandingView | null; appearance?: unknown } | null) => {
        if (cancelled || !data) return;
        current = {
          org: data.org
            ? { accentColor: data.org.accentColor, applyAccentToApp: data.org.applyAccentToApp }
            : null,
          appearance: parseAppearancePrefs(data.appearance),
        };
        applyBranding(current);
      })
      .catch(() => {
        /* offline: cached paint stands */
      });

    // 3. The accent derivation is theme-specific, so re-derive when theme flips.
    const onTheme = () => applyBranding({ ...current, cache: false });
    const onAppearance = (event: Event) => {
      const detail = (event as CustomEvent<typeof current>).detail;
      if (!detail) return;
      current = { org: detail.org, appearance: parseAppearancePrefs(detail.appearance) };
      applyBranding(current);
    };
    window.addEventListener("vantage-theme", onTheme);
    window.addEventListener(APPEARANCE_EVENT, onAppearance);

    return () => {
      cancelled = true;
      window.removeEventListener("vantage-theme", onTheme);
      window.removeEventListener(APPEARANCE_EVENT, onAppearance);
    };
  }, []);

  return null;
}
