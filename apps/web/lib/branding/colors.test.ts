import { describe, expect, it } from "vitest";
import {
  ACCENT_CONTRAST_TARGET,
  DEFAULT_ACCENT,
  SOFT_CARD_SURFACE,
  accentCssVariables,
  buildAccentPlan,
  contrastRatio,
  guardAccentForSurface,
  isValidHexColor,
  mixHex,
  normalizeHexColor,
  readableInkOn,
  relativeLuminance,
} from "./colors";

describe("hex validation", () => {
  it("canonicalizes the forms a human actually types", () => {
    expect(normalizeHexColor("#1457D9")).toBe("#1457d9");
    expect(normalizeHexColor("1457d9")).toBe("#1457d9");
    expect(normalizeHexColor("  #ABC ")).toBe("#aabbcc");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
  });

  it("rejects anything the database CHECK would reject", () => {
    for (const bad of [
      "",
      "#12345",
      "#1234567",
      "rgb(1,2,3)",
      "red",
      "#gggggg",
      "#1457d9;background:url(x)",
      null,
      undefined,
      12345,
      ["#1457d9"],
      { hex: "#1457d9" },
    ]) {
      expect(normalizeHexColor(bad)).toBeNull();
      expect(isValidHexColor(bad)).toBe(false);
    }
  });

  it("only ever emits values matching the 0467 CHECK pattern", () => {
    for (const input of ["#ABC", "0f0", "#00FF7f"]) {
      expect(normalizeHexColor(input)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("contrast maths", () => {
  it("matches the WCAG reference anchors", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 4);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 6);
    // Symmetric regardless of argument order.
    expect(contrastRatio("#1457d9", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#1457d9"), 10);
  });

  it("agrees that the stock accents already pass on their own card", () => {
    expect(contrastRatio(DEFAULT_ACCENT.light, SOFT_CARD_SURFACE.light)).toBeGreaterThanOrEqual(
      ACCENT_CONTRAST_TARGET,
    );
    expect(contrastRatio(DEFAULT_ACCENT.dark, SOFT_CARD_SURFACE.dark)).toBeGreaterThanOrEqual(
      ACCENT_CONTRAST_TARGET,
    );
  });

  it("blends linearly and clamps the mix amount", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 5)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", -3)).toBe("#000000");
  });

  it("picks readable ink for text sitting on the fill", () => {
    expect(readableInkOn("#1457d9")).toBe("#ffffff");
    expect(readableInkOn("#ffeb3b")).toBe("#111827");
  });
});

describe("accent contrast guard", () => {
  it("leaves a compliant accent untouched", () => {
    const guard = guardAccentForSurface("#1457d9", SOFT_CARD_SURFACE.light);
    expect(guard.chosenPasses).toBe(true);
    expect(guard.adjusted).toBe(false);
    expect(guard.color).toBe("#1457d9");
    expect(guard.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET);
  });

  it("darkens a too-light accent on the light card", () => {
    const guard = guardAccentForSurface("#ffeb3b", SOFT_CARD_SURFACE.light);
    expect(guard.chosenPasses).toBe(false);
    expect(guard.adjusted).toBe(true);
    expect(guard.meetsTarget).toBe(true);
    expect(guard.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET);
    expect(relativeLuminance(guard.color)).toBeLessThan(relativeLuminance("#ffeb3b"));
  });

  it("lightens a too-dark accent on the dark card", () => {
    const guard = guardAccentForSurface("#1457d9", SOFT_CARD_SURFACE.dark);
    expect(guard.chosenPasses).toBe(false);
    expect(guard.meetsTarget).toBe(true);
    expect(guard.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET);
    expect(relativeLuminance(guard.color)).toBeGreaterThan(relativeLuminance("#1457d9"));
  });

  it("clears the target for every hue a team might pick, on both cards", () => {
    const hexes = [
      "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffeb3b",
      "#7c3aed", "#0f766e", "#f97316", "#111827", "#e11d48", "#84cc16",
    ];
    for (const hex of hexes) {
      for (const surface of [SOFT_CARD_SURFACE.light, SOFT_CARD_SURFACE.dark]) {
        const guard = guardAccentForSurface(hex, surface);
        expect(guard.meetsTarget).toBe(true);
        expect(contrastRatio(guard.color, surface)).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET);
      }
    }
  });
});

describe("accent plan", () => {
  it("returns null for an unusable hex", () => {
    expect(buildAccentPlan("not-a-colour")).toBeNull();
    expect(buildAccentPlan(null)).toBeNull();
  });

  it("keeps the literal hex as the non-text brand and guards the text accent", () => {
    const plan = buildAccentPlan("#ffeb3b")!;
    expect(plan.hex).toBe("#ffeb3b");
    expect(plan.light.brand).toBe("#ffeb3b");
    expect(plan.light.accent).not.toBe("#ffeb3b");
    expect(plan.light.brandInk).toBe("#111827");
    expect(plan.textUnsafe).toBe(true);
    expect(plan.warning).toContain("#ffeb3b");
    expect(plan.warning).toContain("4.5:1");
  });

  it("stays silent when the chosen colour is safe on both cards", () => {
    // Mid-tone teal clears 4.5:1 against #ffffff and against #151b24.
    const plan = buildAccentPlan("#0f766e")!;
    expect(plan.light.guard.chosenPasses || plan.dark.guard.chosenPasses).toBe(true);
    if (!plan.textUnsafe) expect(plan.warning).toBeNull();
  });

  it("emits inline custom properties per theme", () => {
    const plan = buildAccentPlan("#1457d9")!;
    const light = accentCssVariables(plan, "light");
    const dark = accentCssVariables(plan, "dark");
    expect(light["--soft-brand"]).toBe("#1457d9");
    expect(dark["--soft-brand"]).toBe("#1457d9");
    expect(light["--accent"]).toBe(light["--soft-accent"]);
    expect(light["--accent-soft"]).toBe(light["--soft-accent-soft"]);
    expect(light["--accent-ink"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(light["--accent-hover"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(light["--accent-hover"]).toBe(light["--app-accent-hover"]);
    // Text accent differs by theme because the card underneath differs.
    expect(light["--soft-accent"]).not.toBe(dark["--soft-accent"]);
    expect(light["--accent"]).not.toBe(dark["--accent"]);
    expect(contrastRatio(light["--soft-accent"]!, SOFT_CARD_SURFACE.light)).toBeGreaterThanOrEqual(
      ACCENT_CONTRAST_TARGET,
    );
    expect(contrastRatio(dark["--soft-accent"]!, SOFT_CARD_SURFACE.dark)).toBeGreaterThanOrEqual(
      ACCENT_CONTRAST_TARGET,
    );
    for (const value of Object.values(light)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
