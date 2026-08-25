import { describe, expect, it } from "vitest";
import { isLearningSurface } from "./learning-mode";
import {
  foldModePrefRows,
  parseStoredMode,
  resolveEffectiveMode,
  resolveStoredMode,
  serializeStoredMode,
  shouldMigrateDeviceMode,
  surfaceModeStorageKey,
  LEGACY_MODE_STORAGE_KEY,
} from "./mode-store";

describe("resolveStoredMode / resolveEffectiveMode precedence", () => {
  it("lets an explicit per-surface pref beat everything", () => {
    expect(
      resolveEffectiveMode({ role: "scout", surfacePref: false, memberDefault: true, deviceStored: true }),
    ).toEqual({ enabled: false, source: "surface_pref" });
  });

  it("falls back to the member default when no surface pref exists", () => {
    expect(
      resolveEffectiveMode({ role: "owner", surfacePref: null, memberDefault: true, deviceStored: false }),
    ).toEqual({ enabled: true, source: "member_default" });
  });

  it("honours the legacy device value until it is migrated", () => {
    expect(
      resolveEffectiveMode({ role: "scout", surfacePref: null, memberDefault: null, deviceStored: false }),
    ).toEqual({ enabled: false, source: "device" });
  });

  it("uses the role default when no choice exists anywhere", () => {
    expect(resolveEffectiveMode({ role: "scout", surfacePref: null, memberDefault: null, deviceStored: null }))
      .toEqual({ enabled: true, source: "role_default" });
    expect(resolveEffectiveMode({ role: "owner", surfacePref: null, memberDefault: null, deviceStored: null }))
      .toEqual({ enabled: false, source: "role_default" });
  });

  it("resolveStoredMode returns null (not a role default) when nothing is stored", () => {
    expect(resolveStoredMode({ surfacePref: null, memberDefault: null, deviceStored: null })).toBeNull();
    expect(resolveStoredMode({ surfacePref: undefined, memberDefault: false, deviceStored: true })).toBe(false);
  });
});

describe("shouldMigrateDeviceMode", () => {
  it("migrates only when the device has a choice and the server has none", () => {
    expect(shouldMigrateDeviceMode({ surfacePref: null, memberDefault: null, deviceStored: true })).toBe(true);
    expect(shouldMigrateDeviceMode({ surfacePref: null, memberDefault: null, deviceStored: false })).toBe(true);
  });

  it("never overwrites a server-side choice and never migrates nothing", () => {
    expect(shouldMigrateDeviceMode({ surfacePref: null, memberDefault: true, deviceStored: false })).toBe(false);
    expect(shouldMigrateDeviceMode({ surfacePref: false, memberDefault: null, deviceStored: true })).toBe(false);
    expect(shouldMigrateDeviceMode({ surfacePref: null, memberDefault: null, deviceStored: null })).toBe(false);
  });
});

describe("storage format", () => {
  it("round-trips on/off and rejects anything else", () => {
    expect(parseStoredMode(serializeStoredMode(true))).toBe(true);
    expect(parseStoredMode(serializeStoredMode(false))).toBe(false);
    expect(parseStoredMode("yes")).toBeNull();
    expect(parseStoredMode(null)).toBeNull();
  });

  it("keeps the legacy key as the prefix of every per-surface key", () => {
    expect(surfaceModeStorageKey("gearbox")).toBe(`${LEGACY_MODE_STORAGE_KEY}:gearbox`);
  });
});

describe("foldModePrefRows", () => {
  it("splits the NULL-surface member default from per-surface overrides", () => {
    const prefs = foldModePrefRows(
      [
        { surface: null, enabled: true },
        { surface: "gearbox", enabled: false },
        { surface: "not-a-surface", enabled: true },
      ],
      isLearningSurface,
    );
    expect(prefs.memberDefault).toBe(true);
    expect(prefs.surfaces).toEqual({ gearbox: false });
  });

  it("returns an honest empty shape for no rows", () => {
    const prefs = foldModePrefRows([], isLearningSurface);
    expect(prefs.memberDefault).toBeNull();
    expect(prefs.surfaces).toEqual({});
  });
});
