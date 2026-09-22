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
  it("defaults to comfortable, full motion, regular glass, team accent on", () => {
    expect(DEFAULT_APPEARANCE_PREFS).toEqual({
      density: "comfortable",
      motion: "full",
      clarity: "regular",
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
    const prefs = {
      density: "compact",
      motion: "reduced",
      clarity: "solid",
      teamAccent: false,
    } as const;
    expect(parseAppearancePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    expect(appearanceEquals(parseAppearancePrefs(prefs), prefs)).toBe(true);
    expect(appearanceEquals(prefs, DEFAULT_APPEARANCE_PREFS)).toBe(false);
  });
});

describe("density token mapping", () => {
  it("mirrors the calc() ramp in system.css", () => {
    const comfortable = densityTokens("comfortable");
    expect(comfortable).toEqual({
      "--space-1": 4,
      "--space-2": 8,
      "--space-3": 12,
      "--space-4": 16,
      "--space-5": 20,
      "--space-6": 24,
    });

    const compact = densityTokens("compact");
    for (const [index, base] of SPACE_RAMP.entries()) {
      const n = index + 1;
      expect(compact[`--space-${n}`]).toBeCloseTo(base * DENSITY_SCALE.compact, 6);
      expect(compact[`--soft-space-${n}`]).toBeUndefined();
      expect(compact[`--space-${n}`]!).toBeLessThan(comfortable[`--space-${n}`]!);
      expect(compact[`--space-${n}`]!).toBeGreaterThan(0);
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
      "data-clarity": null,
    });
    expect(
      appearanceAttributes({
        density: "compact",
        motion: "reduced",
        clarity: "solid",
        teamAccent: true,
      }),
    ).toEqual({ "data-density": "compact", "data-motion": "reduced", "data-clarity": "solid" });
  });

  it("leaves data-clarity off for regular, which is what the stylesheet does anyway", () => {
    // An attribute that changes nothing is a thing somebody debugs later.
    expect(
      appearanceAttributes({ ...DEFAULT_APPEARANCE_PREFS, clarity: "regular" })["data-clarity"],
    ).toBeNull();
    expect(
      appearanceAttributes({ ...DEFAULT_APPEARANCE_PREFS, clarity: "clear" })["data-clarity"],
    ).toBe("clear");
  });

  it("defaults clarity when the stored value is missing or junk", () => {
    // Every profile written before this preference existed parses through here.
    expect(parseAppearancePrefs({ density: "compact" }).clarity).toBe("regular");
    expect(parseAppearancePrefs({ clarity: "frosted" }).clarity).toBe("regular");
    expect(parseAppearancePrefs({ clarity: "solid" }).clarity).toBe("solid");
  });

  it("treats a clarity change as a change", () => {
    // appearanceEquals decides whether to PUT; missing a field means the
    // setting silently fails to save.
    expect(
      appearanceEquals(DEFAULT_APPEARANCE_PREFS, { ...DEFAULT_APPEARANCE_PREFS, clarity: "solid" }),
    ).toBe(false);
    expect(appearanceEquals(DEFAULT_APPEARANCE_PREFS, { ...DEFAULT_APPEARANCE_PREFS })).toBe(true);
  });
});

describe("branding view helpers", () => {
  it("needs a colour, the team switch, and the member switch all on", () => {
    const on = { accentColor: "#17457f", applyAccentToApp: true };
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
