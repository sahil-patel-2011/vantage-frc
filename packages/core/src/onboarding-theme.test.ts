/**
 * QA A1-03: Dark picked on the onboarding Finish screen was saved but never applied, because the
 * finish upsert wrote theme_preference without theme_chosen_at, and /api/theme only reports a
 * stamped value as the person's choice.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { completeOnboarding, type OnboardingPayload } from "./onboarding";

function recordingClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const payload: OnboardingPayload = {
  firstName: "Avery",
  lastName: "Nguyen",
  dateOfBirth: "2010-04-11",
  gender: "prefer_not_to_say",
  preferredTeamNumber: null,
  teamRole: "student",
  primaryFocus: "competition",
  termsAccepted: true,
  privacyAccepted: true,
};

function profileUpsert(calls: Array<{ sql: string; params: unknown[] }>) {
  const call = calls.find((entry) => /INSERT INTO profiles\(\s*user_id, first_name/.test(entry.sql));
  if (!call) throw new Error("profile upsert not sent");
  return call;
}

describe("the appearance picked while joining", () => {
  it("is stamped as a choice, so the account's theme follows it", async () => {
    const { client, calls } = recordingClient();
    await completeOnboarding(client, "00000000-0000-4000-8000-000000000001", { ...payload, themePreference: "dark" });
    const upsert = profileUpsert(calls);
    expect(upsert.sql).toMatch(/theme_chosen_at = CASE WHEN \$14::boolean THEN now\(\)/);
    expect(upsert.params[11]).toBe("dark");
    expect(upsert.params[13]).toBe(true);
  });

  it("is not a choice when the person left it alone, so the device keeps deciding", async () => {
    const { client, calls } = recordingClient();
    await completeOnboarding(client, "00000000-0000-4000-8000-000000000002", payload);
    const upsert = profileUpsert(calls);
    expect(upsert.params[13]).toBe(false);
    // An unanswered Finish must not overwrite a theme already chosen in Account.
    expect(upsert.sql).toMatch(/theme_preference = CASE WHEN \$14::boolean THEN excluded\.theme_preference ELSE profiles\.theme_preference END/);
  });
});
