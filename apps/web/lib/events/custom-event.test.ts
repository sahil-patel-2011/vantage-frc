import { describe, expect, it } from "vitest";
import {
  CUSTOM_EVENT_KEY_PATTERN,
  customEventKey,
  customEventProblemCopy,
  isCustomEventKey,
  slugifyEventName,
  validateCustomEvent,
  type CustomEventDraft,
} from "./custom-event";

const ORG = "3f2a91b4-7c6d-4e5f-8a1b-2c3d4e5f6a7b";
const OTHER_ORG = "91b43f2a-6d7c-4f5e-8b1a-3d2c5e4f7a6b";

const GRITS: CustomEventDraft = { name: "GRITS", year: 2026 };

describe("customEventKey", () => {
  it("cannot collide with a Blue Alliance key", () => {
    // TBA keys are a year then lowercase alphanumerics with no separators.
    // Every key we mint contains hyphens, so the two sets are disjoint by
    // construction rather than by hoping the namespaces stay apart.
    const key = customEventKey(ORG, GRITS);
    expect(key).toContain("-");
    expect(/^\d{4}[a-z0-9]+$/.test(key)).toBe(false);
    expect(isCustomEventKey("2026gagai")).toBe(false);
  });

  it("matches what the database policy will accept", () => {
    expect(CUSTOM_EVENT_KEY_PATTERN.test(customEventKey(ORG, GRITS))).toBe(true);
  });

  it("keeps two teams running the same event off the same primary key", () => {
    expect(customEventKey(ORG, GRITS)).not.toBe(customEventKey(OTHER_ORG, GRITS));
  });

  it("is stable for the same team and name", () => {
    expect(customEventKey(ORG, GRITS)).toBe(customEventKey(ORG, { ...GRITS }));
  });

  it("separates the same event across seasons", () => {
    expect(customEventKey(ORG, { name: "GRITS", year: 2026 })).not.toBe(
      customEventKey(ORG, { name: "GRITS", year: 2027 }),
    );
  });

  it("survives a name that is punctuation and spacing around a word", () => {
    const key = customEventKey(ORG, { name: "  ***GRITS 2026!!!  ", year: 2026 });
    expect(CUSTOM_EVENT_KEY_PATTERN.test(key)).toBe(true);
    expect(key.endsWith("grits-2026")).toBe(true);
  });

  it("survives a long name whose cut lands on a separator", () => {
    // Truncating to the slug limit can leave a trailing hyphen, which the
    // pattern rejects. A 41-character event name must not be unaddable.
    const name = `${"a".repeat(40)} Championship`;
    const key = customEventKey(ORG, { name, year: 2026 });
    expect(CUSTOM_EVENT_KEY_PATTERN.test(key)).toBe(true);
    expect(key.endsWith("-")).toBe(false);
  });

  it("refuses an orgId that is not a uuid", () => {
    expect(() => customEventKey("not-a-uuid", GRITS)).toThrow(/uuid/i);
  });

  it("refuses to mint a key the database would reject", () => {
    expect(() => customEventKey(ORG, { name: "!!!", year: 2026 })).toThrow();
  });
});

describe("slugifyEventName", () => {
  it("handles names with no usable characters", () => {
    expect(slugifyEventName("!!!")).toBe("");
    expect(slugifyEventName("   ")).toBe("");
  });

  it("collapses runs of separators rather than stacking hyphens", () => {
    expect(slugifyEventName("Battle   of  --  the  Bay")).toBe("battle-of-the-bay");
  });

  it("keeps non-English names addable by what survives transliteration", () => {
    // Nothing ASCII survives, so the name is unusable as a key and validation
    // says so — better than minting an empty slug the database will refuse.
    expect(slugifyEventName("東京オフシーズン")).toBe("");
  });
});

describe("validateCustomEvent", () => {
  it("accepts the minimum a team actually knows: a name and a year", () => {
    expect(validateCustomEvent(GRITS)).toEqual([]);
  });

  it("reports every problem at once so the form says all of it", () => {
    const problems = validateCustomEvent({ name: "", year: 1200 });
    expect(problems).toContain("name-required");
    expect(problems).toContain("year-invalid");
  });

  it("rejects a date that looks real but is not", () => {
    // Date.parse rolls 31 February into March without complaint; a typo in the
    // pit would silently become a schedule starting on the wrong day.
    expect(validateCustomEvent({ ...GRITS, startDate: "2026-02-31" })).toContain("date-invalid");
  });

  it("rejects an event that ends before it starts", () => {
    expect(
      validateCustomEvent({ ...GRITS, startDate: "2026-10-04", endDate: "2026-10-02" }),
    ).toContain("dates-reversed");
  });

  it("allows a one-day event", () => {
    expect(
      validateCustomEvent({ ...GRITS, startDate: "2026-10-04", endDate: "2026-10-04" }),
    ).toEqual([]);
  });

  it("treats blank dates as not supplied, not as invalid", () => {
    expect(validateCustomEvent({ ...GRITS, startDate: "", endDate: "  " })).toEqual([]);
  });

  it("has readable copy for every problem it can report", () => {
    const problems = [
      "name-required",
      "name-too-long",
      "name-unusable",
      "year-invalid",
      "dates-reversed",
      "date-invalid",
    ] as const;
    for (const problem of problems) {
      const copy = customEventProblemCopy(problem);
      // A sentence, not a code: the problem identifier must never reach a screen.
      expect(copy, problem).not.toContain(problem);
      expect(copy.length, problem).toBeGreaterThan(10);
      expect(copy.endsWith("."), problem).toBe(true);
    }
  });
});
