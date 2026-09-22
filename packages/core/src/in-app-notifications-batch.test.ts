import { describe, expect, it } from "vitest";
import { emitPreferredNotifications } from "./in-app-notifications";

type Call = { sql: string; params: unknown[] };

function fakeClient(profiles: Array<{ userId: string; notificationPrefs: unknown }>) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM profiles")) return { rows: profiles };
      return { rows: [] };
    },
  };
  return { client: client as never, calls };
}

describe("emitPreferredNotifications", () => {
  it("reads prefs once and inserts every allowed row in one statement, in input order", async () => {
    const { client, calls } = fakeClient([
      { userId: "u2", notificationPrefs: { teamChat: false } },
      { userId: "u3", notificationPrefs: {} },
    ]);
    const flags = await emitPreferredNotifications(client, [
      { userId: "u1", orgId: "o", type: "message_mention", payload: { n: 1 } },
      { userId: "u2", orgId: "o", type: "team_chat", payload: { n: 2 } },
      { userId: "u3", orgId: "o", type: "team_chat", payload: { n: 3 } },
      { userId: "u2", orgId: "o", type: "team_access_request" },
    ]);

    // u1 has no profile row -> defaults (on); u2 opted out of team chat; the
    // access-request type is never gated by prefs.
    expect(flags).toEqual([{ emitted: true }, { emitted: false }, { emitted: true }, { emitted: true }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toMatch(/user_id = ANY\(\$1::uuid\[\]\)/);
    expect(calls[0]!.params).toEqual([["u1", "u2", "u3"]]);
    expect(calls[1]!.sql).toMatch(/INSERT INTO notifications/);
    expect(calls[1]!.params).toEqual([
      ["u1", "u3", "u2"],
      ["o", "o", "o"],
      ["message_mention", "team_chat", "team_access_request"],
      [JSON.stringify({ n: 1 }), JSON.stringify({ n: 3 }), "{}"],
    ]);
  });

  it("skips the prefs read for ungated types and does nothing for an empty fan-out", async () => {
    const empty = fakeClient([]);
    expect(await emitPreferredNotifications(empty.client, [])).toEqual([]);
    expect(empty.calls).toHaveLength(0);

    const ungated = fakeClient([]);
    await emitPreferredNotifications(ungated.client, [{ userId: "u1", type: "team_access_approved" }]);
    expect(ungated.calls).toHaveLength(1);
    expect(ungated.calls[0]!.params[1]).toEqual([null]);
  });

  it("writes nothing when every recipient opted out", async () => {
    const { client, calls } = fakeClient([{ userId: "u1", notificationPrefs: { teamChat: false } }]);
    const flags = await emitPreferredNotifications(client, [{ userId: "u1", orgId: "o", type: "team_chat" }]);
    expect(flags).toEqual([{ emitted: false }]);
    expect(calls.map((call) => call.sql).some((sql) => sql.includes("INSERT"))).toBe(false);
  });
});
