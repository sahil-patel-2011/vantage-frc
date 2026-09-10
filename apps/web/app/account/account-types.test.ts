import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_PREFS,
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_PREF_LABELS,
  PREF_LABELS,
  type EmailPrefs,
  type NotificationPrefs,
} from "./account-types";

describe("account preference switches", () => {
  it("shows a switch for every in-app pref the form can save", () => {
    const keys = PREF_LABELS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual((Object.keys(DEFAULT_NOTIFICATION_PREFS) as (keyof NotificationPrefs)[]).sort());
  });

  it("shows a switch for every email pref the form can save", () => {
    const keys = EMAIL_PREF_LABELS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual((Object.keys(DEFAULT_EMAIL_PREFS) as (keyof EmailPrefs)[]).sort());
  });
});
