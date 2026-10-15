import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { detectOrgByokKeySource, memberHasUsableKey, TEAM_USAGE_SQL, teamUsageSql } from "../src";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";

function client(answers: { tables?: { own: boolean; shared: boolean }; usable?: boolean }) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/to_regclass/.test(sql)) return { rows: [answers.tables ?? { own: true, shared: true }] };
    if (/FROM member_llm_keys/.test(sql)) return { rows: [{ usable: Boolean(answers.usable) }] };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

describe("memberHasUsableKey", () => {
  it("counts the member's own key or one shared with them", async () => {
    expect(await memberHasUsableKey(client({ usable: true }).client, ORG, USER)).toBe(true);
    expect(await memberHasUsableKey(client({ usable: false }).client, ORG, USER)).toBe(false);
    const withShared = client({ usable: true });
    await memberHasUsableKey(withShared.client, ORG, USER);
    expect(withShared.calls.some((sql) => /FROM shared_member_llm_keys/.test(sql))).toBe(true);
  });

  it("answers false, without a failing query, before the tables exist", async () => {
    const missing = client({ tables: { own: false, shared: false } });
    expect(await memberHasUsableKey(missing.client, ORG, USER)).toBe(false);
    expect(missing.calls.some((sql) => /FROM member_llm_keys/.test(sql))).toBe(false);
    const noSharing = client({ tables: { own: true, shared: false }, usable: true });
    expect(await memberHasUsableKey(noSharing.client, ORG, USER)).toBe(true);
    expect(noSharing.calls.some((sql) => /FROM shared_member_llm_keys/.test(sql))).toBe(false);
  });

  it("never casts a worker or system id that is not a uuid", async () => {
    const worker = client({ usable: true });
    expect(await memberHasUsableKey(worker.client, ORG, "system")).toBe(false);
    expect(worker.calls).toEqual([]);
  });
});

describe("detectOrgByokKeySource", () => {
  it("treats a member's personal key as bring-your-own when the team has none", async () => {
    expect(await detectOrgByokKeySource(client({ usable: true }).client, ORG, USER)).toBe("byo");
    expect(await detectOrgByokKeySource(client({ usable: false }).client, ORG, USER)).toBeNull();
    // No person given (a team-level call): only team keys count, as before.
    expect(await detectOrgByokKeySource(client({ usable: true }).client, ORG)).toBeNull();
  });
});

describe("per-key monthly limits", () => {
  it("never counts a personal key, own or shared, once it has reached its limit", async () => {
    const probe = client({ usable: true });
    await memberHasUsableKey(probe.client, ORG, USER);
    const keySql = probe.calls.find((sql) => /FROM member_llm_keys/.test(sql))!;
    expect(keySql.match(/monthly_spend_limit_usd/g)?.length).toBeGreaterThanOrEqual(4);
    expect(keySql).toMatch(/FROM shared_member_llm_keys\(\$1::uuid\) k WHERE/);
  });

  it("does the same for team keys", async () => {
    const probe = client({ usable: false });
    await detectOrgByokKeySource(probe.client, ORG, USER);
    const teamSql = probe.calls.find((sql) => /FROM org_llm_keys/.test(sql))!;
    expect(teamSql).toContain("monthly_spend_limit_usd");
    expect(teamSql).toContain("{servedKey,id}");
  });

  it("team usage leaves out rows a personal key served", () => {
    expect(TEAM_USAGE_SQL).toBe("COALESCE(metadata #>> '{servedKey,scope}', '') <> 'member'");
    expect(teamUsageSql("a")).toBe("COALESCE(a.metadata #>> '{servedKey,scope}', '') <> 'member'");
  });
});
