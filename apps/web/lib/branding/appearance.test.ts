import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_PREFS,
  DENSITY_SCALE,
  SPACE_RAMP,
  appearanceAttributes,
  appearanceEquals,
  densityTokens,
  parseAppearancePrefs,
} from "./appearance";
import { accentIsActive, formatLogoSize, brandingLogoUrl, emptyBrandingView } from "./branding";

describe("appearance preferences", () => {
  it("defaults to comfortable, full motion, team accent on", () => {
    expect(DEFAULT_APPEARANCE_PREFS).toEqual({
      density: "comfortable",
      motion: "full",
      teamAccent: true,
    });
  });

  it("survives partial, legacy, and hostile payloads", () => {
    expect(parseAppearancePrefs(undefined)).toEqual(DEFAULT_APPEARANCE_PREFS);
    expect(parseAppearancePrefs(null)).toEqual(DEFAULT_APPEARANCE_PREFS);
    expect(parseAppearancePrefs("compact")).toEqual(DEFAULT_APPEARANCE_PREFS);
    expect(parseAppearancePrefs([])).toEqual(DEFAULT_APPEARANCE_PREFS);
    expect(parseAppearancePrefs({ density: "tiny" })).toEqual(DEFAULT_APPEARANCE_PREFS);
    expect(parseAppearancePrefs({ density: "compact" })).toEqual({
      ...DEFAULT_APPEARANCE_PREFS,
      density: "compact",
    });
    expect(parseAppearancePrefs({ teamAccent: "yes" }).teamAccent).toBe(true);
    expect(parseAppearancePrefs({ teamAccent: false }).teamAccent).toBe(false);
    // Unknown keys are dropped rather than persisted.
    expect(parseAppearancePrefs({ motion: "reduced", evil: "<script>" })).toEqual({
      ...DEFAULT_APPEARANCE_PREFS,
      motion: "reduced",
    });
  });

  it("round-trips through JSON exactly as the jsonb column would", () => {
    const prefs = { density: "compact", motion: "reduced", teamAccent: false } as const;
    expect(parseAppearancePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    expect(appearanceEquals(parseAppearancePrefs(prefs), prefs)).toBe(true);
    expect(appearanceEquals(prefs, DEFAULT_APPEARANCE_PREFS)).toBe(false);
  });
});

describe("density token mapping", () => {
  it("mirrors the calc() ramp in soft-ui.css", () => {
    const comfortable = densityTokens("comfortable");
    expect(comfortable).toEqual({
      "--soft-space-1": 4,
      "--soft-space-2": 8,
      "--soft-space-3": 12,
      "--soft-space-4": 16,
      "--soft-space-5": 20,
      "--soft-space-6": 24,
    });

    const compact = densityTokens("compact");
    for (const [index, base] of SPACE_RAMP.entries()) {
      expect(compact[`--soft-space-${index + 1}`]).toBeCloseTo(base * DENSITY_SCALE.compact, 6);
      // Compact is strictly tighter, and never collapses to zero.
      expect(compact[`--soft-space-${index + 1}`]!).toBeLessThan(comfortable[`--soft-space-${index + 1}`]!);
      expect(compact[`--soft-space-${index + 1}`]!).toBeGreaterThan(0);
    }
  });

  it("keeps comfortable as the identity scale", () => {
    expect(DENSITY_SCALE.comfortable).toBe(1);
    expect(DENSITY_SCALE.compact).toBeLessThan(1);
    expect(DENSITY_SCALE.compact).toBeGreaterThan(0.5);
  });

  it("stamps html attributes only when the pref is non-default", () => {
    expect(appearanceAttributes(DEFAULT_APPEARANCE_PREFS)).toEqual({
      "data-density": null,
      "data-motion": null,
    });
    expect(
      appearanceAttributes({ density: "compact", motion: "reduced", teamAccent: true }),
    ).toEqual({ "data-density": "compact", "data-motion": "reduced" });
  });
});

describe("branding view helpers", () => {
  it("needs a colour, the team switch, and the member switch all on", () => {
    const on = { accentColor: "#1f4fd6", applyAccentToApp: true };
    expect(accentIsActive(on, { teamAccent: true })).toBe(true);
    expect(accentIsActive(on, { teamAccent: false })).toBe(false);
    expect(accentIsActive({ ...on, applyAccentToApp: false }, { teamAccent: true })).toBe(false);
    expect(accentIsActive({ accentColor: null, applyAccentToApp: true }, { teamAccent: true })).toBe(false);
    expect(accentIsActive(null, { teamAccent: true })).toBe(false);
  });

  it("builds a cache-busting logo url only when a logo exists", () => {
    const view = emptyBrandingView("11111111-1111-1111-1111-111111111111");
    expect(brandingLogoUrl(view)).toBeNull();
    const withLogo = {
      ...view,
      logo: { present: true, width: 128, height: 64, byteSize: 4096, version: "abc123def456" },
    };
    expect(brandingLogoUrl(withLogo)).toBe(
      "/api/branding/logo?orgId=11111111-1111-1111-1111-111111111111&v=abc123def456",
    );
  });

  it("formats stored sizes without inventing a number", () => {
    expect(formatLogoSize(null)).toBe("—");
    expect(formatLogoSize(0)).toBe("—");
    expect(formatLogoSize(512)).toBe("512 B");
    expect(formatLogoSize(4096)).toBe("4 KB");
  });
});
