import { describe, expect, it, vi } from "vitest";
import {
  VIEW_ONLY_MESSAGE,
  ViewOnlyError,
  assertNotViewOnly,
  explainWriteRefusal,
  isRowSecurityRefusal,
  isViewOnlyRefusal,
} from "./view-only";

/** What node-postgres hands back for the 0715 policy refusal. */
function pgError(fields: { code?: string; detail?: string; message: string }) {
  return Object.assign(new Error(fields.message), fields);
}

const OWN_REFUSAL = pgError({ code: "42501", detail: "vantage:view_only", message: VIEW_ONLY_MESSAGE });
const GENERIC_RLS = pgError({ code: "42501", message: 'new row violates row-level security policy for table "invites"' });
const UNIQUE = pgError({ code: "23505", message: "duplicate key value violates unique constraint" });

function fakeClient(viewer: boolean | Error) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/is_org_viewer/.test(sql)) {
      if (viewer instanceof Error) throw viewer;
      return { rows: [{ viewer }] };
    }
    return { rows: [] };
  });
  return { client: { query }, calls };
}

describe("View only refusals", () => {
  it("recognises the 0715 refusal and ViewOnlyError, nothing else", () => {
    expect(isViewOnlyRefusal(OWN_REFUSAL)).toBe(true);
    expect(isViewOnlyRefusal(new ViewOnlyError())).toBe(true);
    // Same sentence without the detail (a driver that drops DETAIL) still counts.
    expect(isViewOnlyRefusal(pgError({ code: "42501", message: VIEW_ONLY_MESSAGE }))).toBe(true);
    expect(isViewOnlyRefusal(GENERIC_RLS)).toBe(false);
    expect(isViewOnlyRefusal(UNIQUE)).toBe(false);
    expect(isViewOnlyRefusal(new Error(VIEW_ONLY_MESSAGE))).toBe(false);
    expect(isViewOnlyRefusal(null)).toBe(false);
  });

  it("recognises generic row-level-security refusals", () => {
    expect(isRowSecurityRefusal(GENERIC_RLS)).toBe(true);
    expect(isRowSecurityRefusal(pgError({ code: "42501", message: "permission denied for table invites" }))).toBe(false);
    expect(isRowSecurityRefusal(UNIQUE)).toBe(false);
  });

  it("ViewOnlyError carries the sentence, a 403 and the reason", () => {
    const error = new ViewOnlyError({ cause: OWN_REFUSAL });
    expect(error.message).toBe(VIEW_ONLY_MESSAGE);
    expect(error.status).toBe(403);
    expect(error.reason).toBe("view_only");
    expect(error.cause).toBe(OWN_REFUSAL);
    // In the role words people see everywhere else (0721), never "Team member access".
    expect(VIEW_ONLY_MESSAGE).toBe(
      "View only — you can look but not change this. Ask the team owner or a mentor or coach for Student access.",
    );
  });
});

describe("explainWriteRefusal (withRls error path)", () => {
  it("turns the 0715 refusal into ViewOnlyError without touching the database", async () => {
    const { client, calls } = fakeClient(true);
    const explained = await explainWriteRefusal(client, { userId: "u", orgId: "o" }, OWN_REFUSAL);
    expect(explained).toBeInstanceOf(ViewOnlyError);
    expect(calls).toEqual([]);
  });

  it("asks is_org_viewer about a generic RLS refusal, read-only, as the same person", async () => {
    const { client, calls } = fakeClient(true);
    const explained = await explainWriteRefusal(client, { userId: "u", orgId: "o" }, GENERIC_RLS);
    expect(explained).toBeInstanceOf(ViewOnlyError);
    expect((explained as ViewOnlyError).cause).toBe(GENERIC_RLS);
    expect(calls).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL ROLE",
      "SELECT set_config('app.user_id', $1,",
      "SELECT is_org_viewer($1::uuid) AS",
      "ROLLBACK",
    ]);
    expect(client.query).toHaveBeenCalledWith("SELECT is_org_viewer($1::uuid) AS viewer", ["o"]);
  });

  it("without an org, only a person who is View only everywhere counts", async () => {
    const { client } = fakeClient(true);
    await explainWriteRefusal(client, { userId: "u" }, GENERIC_RLS);
    const lookup = client.query.mock.calls.find(([sql]) => /is_org_viewer/.test(sql))?.[0] ?? "";
    expect(lookup).toMatch(/bool_and\(is_org_viewer\(m\.org_id\)\)/);
  });

  it("keeps the original error for members, other failures and a failed lookup", async () => {
    expect(await explainWriteRefusal(fakeClient(false).client, { userId: "u", orgId: "o" }, GENERIC_RLS)).toBe(GENERIC_RLS);
    const quiet = fakeClient(true);
    expect(await explainWriteRefusal(quiet.client, { userId: "u", orgId: "o" }, UNIQUE)).toBe(UNIQUE);
    expect(quiet.calls).toEqual([]);
    expect(await explainWriteRefusal(fakeClient(new Error("connection lost")).client, { userId: "u", orgId: "o" }, GENERIC_RLS)).toBe(GENERIC_RLS);
  });

  it("assertNotViewOnly refuses a viewer up front and lets everyone else through", async () => {
    await expect(assertNotViewOnly(fakeClient(true).client, "o")).rejects.toBeInstanceOf(ViewOnlyError);
    await expect(assertNotViewOnly(fakeClient(false).client, "o")).resolves.toBeUndefined();
  });
});
