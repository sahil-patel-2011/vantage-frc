import { describe, expect, it } from "vitest";
import { INBOX_SCOPE_SQL, loadInboxPage, parseInboxCursor } from "./inbox-store";
import { LIVE_NOTIFICATION_SQL } from "./live-sql";

const ID = "6925a000-0000-4000-8000-000000000001";
const ID2 = "6925a000-0000-4000-8000-000000000002";
const ORG = "6925a000-0000-4000-8000-0000000000aa";

function fakeClient(rows: unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    client: {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows, rowCount: rows.length };
      },
    } as never,
  };
}

describe("inbox list query", () => {
  it("finds a live announcement by uuid, never by casting the key to text", () => {
    expect(LIVE_NOTIFICATION_SQL).not.toMatch(/::text\s*=/);
    expect(LIVE_NOTIFICATION_SQL).toMatch(/ta\.id = CASE/);
    expect(LIVE_NOTIFICATION_SQL).toMatch(/::uuid/);
    expect(INBOX_SCOPE_SQL).toMatch(/\$2::uuid IS NULL/);
  });

  it("reads the page, the unread count and the active team in one statement", async () => {
    const { client, calls } = fakeClient([
      { scopeOrgId: ORG, unreadCount: 3, id: ID, orgId: ORG, type: "todo_assigned", payload: { a: 1 }, readAt: null, createdAt: "2026-10-15 12:00:00.123456+00" },
      { scopeOrgId: ORG, unreadCount: 3, id: ID2, orgId: null, type: "product_update", payload: null, readAt: "2026-10-15 13:00:00+00", createdAt: "2026-10-15 11:00:00+00" },
    ]);
    const page = await loadInboxPage(client, { userId: ID, orgId: null, active: true, filter: "all", limit: 1, cursor: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/LIMIT \$5/);
    expect(calls[0]!.sql).toMatch(/FROM memberships m/);
    // One more than shown, to know whether an older page exists.
    expect(calls[0]!.params).toEqual([ID, null, true, "all", 2, null, null]);
    expect(page.orgId).toBe(ORG);
    expect(page.unreadCount).toBe(3);
    expect(page.rows.map((row) => row.id)).toEqual([ID]);
    expect(page.nextCursor).toEqual({ before: "2026-10-15 12:00:00.123456+00", beforeId: ID });
  });

  it("an empty inbox still answers its count and scope, with no next page", async () => {
    const { client } = fakeClient([{ scopeOrgId: ORG, unreadCount: 0, id: null, orgId: null, type: null, payload: null, readAt: null, createdAt: null }]);
    const page = await loadInboxPage(client, { userId: ID, orgId: ORG, active: false, filter: "unread", limit: 40, cursor: null });
    expect(page).toEqual({ orgId: ORG, unreadCount: 0, rows: [], nextCursor: null });
  });

  it("accepts only a well-formed keyset cursor", () => {
    expect(parseInboxCursor(null, null)).toBeNull();
    expect(parseInboxCursor("2026-10-15 12:00:00.123456+00", ID)).toEqual({ before: "2026-10-15 12:00:00.123456+00", beforeId: ID });
    expect(() => parseInboxCursor("2026-10-15 12:00:00+00", null)).toThrow("Invalid page");
    expect(() => parseInboxCursor("yesterday", ID)).toThrow("Invalid page");
    expect(() => parseInboxCursor("2026-10-15 12:00:00+00", "nope")).toThrow("Invalid page");
  });
});
