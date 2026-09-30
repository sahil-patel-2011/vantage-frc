/**
 * Colour maths for the GUI review tools, in one place.
 *
 * This exists because two different implementations gave two different answers
 * about the same badge, and one of them was confidently wrong. The bug was
 * reading `color(srgb 0.88 0.94 0.90)` — whose channels are 0–1 — as if they
 * were 0–255, which turned a 19:1 ratio into 1:1 and would have had somebody
 * "fixing" a contrast problem that did not exist. Every colour format Chromium
 * hands back is handled here, once.
 *
 * Shared by scripts/gui-walk.mjs (injected into the page) and
 * scripts/gui-probe.mjs, so a ratio can never mean two different things.
 */

/** Returns [r, g, b, a] in 0–255 / 0–1, or null when the value is not a colour. */
export function parseColor(value) {
  const input = String(value ?? "").trim();
  if (!input || input === "transparent" || input === "none" || input === "currentcolor") return null;
  if (input.startsWith("color(")) {
    // color(srgb r g b / a) — channels are 0–1. color(display-p3 …) is wider
    // than sRGB; treat its channels as 0–1 too, which under-estimates contrast
    // slightly rather than inventing a pass.
    const numbers = (input.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (numbers.length < 3 || numbers.some(Number.isNaN)) return null;
    const alpha = numbers.length > 3 && !String(numbers[3]).includes("e") ? numbers[3] : 1;
    return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255, alpha];
  }
  const fn = input.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1];
  }
  const hex = input.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((c) => c + c).join("");
    if (digits.length !== 6 && digits.length !== 8) return null;
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
      digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    ];
  }
  return null;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two opaque colours, or null when either is unknown. */
export function contrast(foreground, background) {
  if (!foreground || !background) return null;
  const a = luminance(foreground.slice(0, 3));
  const b = luminance(background.slice(0, 3));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Composite a possibly-translucent colour over an opaque one. */
export function over(top, bottom) {
  const a = top[3] ?? 1;
  if (a >= 1) return [top[0], top[1], top[2], 1];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
}

/**
 * The source of this module as a string, for injection into a page with
 * `page.evaluate`. The functions are plain so they serialise.
 */
export const COLOR_SOURCE = `
const parseColor = ${parseColor.toString()};
const luminance = ${luminance.toString()};
const contrast = ${contrast.toString()};
const over = ${over.toString()};
`;
