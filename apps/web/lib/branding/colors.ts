/**
 * Team-accent colour maths.
 *
 * A team picks one hex. That hex has to survive two very different surfaces
 * (the light card `#ffffff` and the dark card `#151b24`) and two very different
 * jobs (coloured *text* like links and active tabs, versus *fills* like the
 * primary button and the island indicator).
 *
 * `--accent` is contrast-guarded against the card so no team can pick a colour
 * that makes their own UI unreadable. The team's literal hex is stored on
 * `data-brand-accent` for non-text marks. When the two diverge, Team admin is
 * told why.
 */

export const ACCENT_CONTRAST_TARGET = 4.5;

/** Mirrors the `--surface` values in app/system.css. */
export const SOFT_CARD_SURFACE = { light: "#ffffff", dark: "#151b24" } as const;

/** Mirrors the stock `--accent` values in app/system.css. */
export const DEFAULT_ACCENT = { light: "#1457d9", dark: "#6e9bff" } as const;

export type ThemeKey = "light" | "dark";

export type Rgb = { r: number; g: number; b: number };

/**
 * Accepts `#abc`, `abc`, `#AABBCC`, `AABBCC` and returns the canonical lowercase
 * 6-digit form the database CHECK expects. Returns null for anything else.
 */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

export function isValidHexColor(input: unknown): input is string {
  return normalizeHexColor(input) !== null;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex);
  if (!normalized) throw new Error(`Not a hex colour: ${String(hex)}`);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function channelLuminance(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG 2.1 contrast ratio, 1 to 21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Linear blend in sRGB space. `amount` 0 keeps `from`, 1 returns `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export type AccentGuard = {
  /** The colour safe to use for accent-coloured text on this surface. */
  color: string;
  /** Contrast of `color` against the surface. */
  ratio: number;
  /** Contrast of the *chosen* accent against the surface, before any guard. */
  chosenRatio: number;
  /** True when the chosen accent already cleared the target on its own. */
  chosenPasses: boolean;
  /** True when we had to move the colour to clear the target. */
  adjusted: boolean;
  /** False when even a fully blended derivative could not reach the target. */
  meetsTarget: boolean;
};

/**
 * Walks the chosen accent toward white (on dark surfaces) or black (on light
 * surfaces) in 5% steps until it clears `target` against `surface`. Returns the
 * best it managed when the target is unreachable, so callers always get a usable
 * colour and an honest flag rather than a throw.
 */
export function guardAccentForSurface(
  accent: string,
  surface: string,
  target: number = ACCENT_CONTRAST_TARGET,
): AccentGuard {
  const chosenRatio = contrastRatio(accent, surface);
  if (chosenRatio >= target) {
    return {
      color: normalizeHexColor(accent)!,
      ratio: chosenRatio,
      chosenRatio,
      chosenPasses: true,
      adjusted: false,
      meetsTarget: true,
    };
  }

  // Push away from the surface: lighten on a dark card, darken on a light card.
  const towards = relativeLuminance(surface) > 0.35 ? "#000000" : "#ffffff";
  let best = { color: normalizeHexColor(accent)!, ratio: chosenRatio };
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(accent, towards, step / 20);
    const ratio = contrastRatio(candidate, surface);
    if (ratio > best.ratio) best = { color: candidate, ratio };
    if (ratio >= target) {
      return {
        color: candidate,
        ratio,
        chosenRatio,
        chosenPasses: false,
        adjusted: true,
        meetsTarget: true,
      };
    }
  }

  return {
    color: best.color,
    ratio: best.ratio,
    chosenRatio,
    chosenPasses: false,
    adjusted: best.color !== normalizeHexColor(accent),
    meetsTarget: false,
  };
}

/** Black or white — whichever is readable as text sitting *on top of* the fill. */
export function readableInkOn(fill: string): string {
  return contrastRatio(fill, "#ffffff") >= contrastRatio(fill, "#111827") ? "#ffffff" : "#111827";
}

export type AccentPlanTheme = {
  /** The team's literal hex — non-text accents only. */
  brand: string;
  /** Readable ink for text placed on top of `brand`. */
  brandInk: string;
  /** Contrast-guarded accent for text and existing `--accent` rules. */
  accent: string;
  /** Tinted background companion for `--accent-soft`. */
  accentSoft: string;
  guard: AccentGuard;
};

export type AccentPlan = {
  hex: string;
  light: AccentPlanTheme;
  dark: AccentPlanTheme;
  /** True when either theme needed the guard — the admin UI warns on this. */
  textUnsafe: boolean;
  /** Null when nothing is wrong; otherwise the sentence to show the admin. */
  warning: string | null;
};

function planTheme(hex: string, theme: ThemeKey): AccentPlanTheme {
  const surface = SOFT_CARD_SURFACE[theme];
  const guard = guardAccentForSurface(hex, surface);
  return {
    brand: hex,
    brandInk: readableInkOn(hex),
    accent: guard.color,
    // Roughly what the stock tokens do: a 12%/22% wash of the accent over the card.
    accentSoft: mixHex(surface, guard.color, theme === "light" ? 0.12 : 0.22),
    guard,
  };
}

/**
 * Full light + dark derivation for one chosen hex, including the contrast verdict
 * the Team admin panel surfaces.
 */
export function buildAccentPlan(input: unknown): AccentPlan | null {
  const hex = normalizeHexColor(input);
  if (!hex) return null;
  const light = planTheme(hex, "light");
  const dark = planTheme(hex, "dark");
  const failing: string[] = [];
  if (!light.guard.chosenPasses) failing.push("light");
  if (!dark.guard.chosenPasses) failing.push("dark");

  return {
    hex,
    light,
    dark,
    textUnsafe: failing.length > 0,
    warning:
      failing.length === 0
        ? null
        : `${hex} only reaches ${failing
            .map((theme) =>
              theme === "light"
                ? `${light.guard.chosenRatio.toFixed(2)}:1 on the light card`
                : `${dark.guard.chosenRatio.toFixed(2)}:1 on the dark card`,
            )
            .join(" and ")} — below the 4.5:1 needed for text. Vantage keeps your colour for buttons, chips, and the logo lockup, and uses a darkened/lightened version for accent text so nobody on your team gets an unreadable link.`,
  };
}

/**
 * The `style` payload injected on <html>. Written as declarations rather than a
 * stylesheet so it survives navigation and beats the token defaults without any
 * specificity games.
 */
export function accentCssVariables(plan: AccentPlan, theme: ThemeKey): Record<string, string> {
  const side = theme === "dark" ? plan.dark : plan.light;
  // Hover moves away from the card, matching the stock --accent-hover pair.
  const hover = mixHex(side.accent, theme === "dark" ? "#ffffff" : "#000000", 0.16);
  return {
    "--accent": side.accent,
    "--accent-soft": side.accentSoft,
    "--accent-ink": readableInkOn(side.accent),
    "--accent-hover": hover,
  };
}

/** The variable names `accentCssVariables` owns — used to clear the override. */
export const ACCENT_VARIABLE_NAMES = [
  "--accent",
  "--accent-soft",
  "--accent-ink",
  "--accent-hover",
] as const;

/**
 * Leftover `--soft-*` / `--app-*` names a previous visit may have stamped on
 * `<html>`. Strip them so a returning browser cannot keep a second palette.
 */
export const LEGACY_ACCENT_ALIASES = [
  "--soft-accent",
  "--soft-accent-soft",
  "--soft-brand",
  "--soft-brand-ink",
  "--app-accent",
  "--app-accent-hover",
] as const;
