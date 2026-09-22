import { describe, expect, it } from "vitest";
import { asCapabilities } from "./role-profiles";

/**
 * `org_role_profiles.capabilities` is an array of a custom Postgres enum, and
 * node-postgres returns that as the literal string "{a,b}" rather than an array
 * (it only parses arrays of types it knows). The mapper used `?? []`, which
 * passes a string straight through, and Team admin crashed on `.map` for every
 * team that had a profile — the screen owners invite teammates from.
 *
 * Measured against the local database while fixing it:
 *   ARRAY['manage_api_keys']::org_capability[]          → "{manage_api_keys}" (string)
 *   ARRAY['manage_api_keys']::org_capability[]::text[]  → ["manage_api_keys"] (array)
 */
describe("asCapabilities", () => {
  it("passes a real array through", () => {
    expect(asCapabilities(["manage_api_keys"])).toEqual(["manage_api_keys"]);
  });

  it("parses the string node-postgres returns for an enum array", () => {
    expect(asCapabilities("{manage_api_keys}")).toEqual(["manage_api_keys"]);
  });

  it("handles an empty enum array, which arrives as {}", () => {
    expect(asCapabilities("{}")).toEqual([]);
  });

  it("treats null and anything unexpected as no capabilities, never a crash", () => {
    expect(asCapabilities(null)).toEqual([]);
    expect(asCapabilities(undefined)).toEqual([]);
    expect(asCapabilities(42)).toEqual([]);
    expect(asCapabilities({})).toEqual([]);
  });

  it("drops anything that is not a known capability", () => {
    expect(asCapabilities(["manage_api_keys", "become_superuser"])).toEqual(["manage_api_keys"]);
    expect(asCapabilities("{manage_api_keys,become_superuser}")).toEqual(["manage_api_keys"]);
  });

  it("always returns something with .map — the call that crashed the page", () => {
    for (const input of ["{manage_api_keys}", "{}", null, ["manage_api_keys"], "garbage"]) {
      expect(Array.isArray(asCapabilities(input))).toBe(true);
    }
  });
});
