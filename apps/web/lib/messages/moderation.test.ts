import { describe, expect, it, vi } from "vitest";
import {
  ModerationError,
  REMOVED_BY_ADMIN_TEXT,
  attachRemovalNotices,
  dismissReport,
  listOpenReports,
  parseReportInput,
  removalNotice,
  removeMessage,
  reportMessage,
  reportReceipt,
} from "./moderation";

const ORG = "00000000-0000-4000-8000-000000000001";
const STUDENT = "00000000-0000-4000-8000-00000000000a";
const AUTHOR = "00000000-0000-4000-8000-00000000000b";
const ADMIN = "00000000-0000-4000-8000-00000000000c";
const MESSAGE = "00000000-0000-4000-8000-0000000000aa";
const CONVO = "00000000-0000-4000-8000-0000000000cc";

type Handler = [RegExp, (params: unknown[]) => { rows: unknown[] }];

function mockClient(roles: Record<string, string>, handlers: Handler[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM memberships WHERE org_id = \$1::uuid AND user_id/.test(sql)) {
        const role = roles[String(params[1])];
        return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
      }
      for (const [pattern, handler] of handlers) {
        if (pattern.test(sql)) {
          const result = handler(params);
          return { ...result, rowCount: result.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return client;
}

const liveMessage: Handler = [
  /FROM org_messages\s+WHERE id = \$1::uuid AND org_id/,
  () => ({ rows: [{ conversationId: CONVO, authorUserId: AUTHOR, body: "the real text", deletedAt: null }] }),
];

describe("reporting a message", () => {
  it("only accepts a reason from the short list", () => {
    expect(() => parseReportInput({ messageId: MESSAGE, reason: "i dont like them" })).toThrow(ModerationError);
    expect(parseReportInput({ messageId: MESSAGE, reason: "harassment", note: "  mean \n comment " })).toEqual({
      messageId: MESSAGE,
      reason: "harassment",
      note: "mean comment",
    });
  });

  it("snapshots the text and author read from the database, not from the request", async () => {
    const client = mockClient({ [STUDENT]: "scout" }, [
      liveMessage,
      [/INSERT INTO org_message_reports/, () => ({ rows: [{ id: "r1" }] })],
      [/role IN \('owner', 'admin'\)/, () => ({ rows: [{ userId: ADMIN }] })],
    ]);
    const result = await reportMessage(client as never, {
      orgId: ORG,
      userId: STUDENT,
      messageId: MESSAGE,
      reason: "harassment",
      note: null,
    });
    const insert = client.calls.find((c) => /INSERT INTO org_message_reports/.test(c.sql))!;
    expect(insert.params).toEqual([ORG, MESSAGE, CONVO, STUDENT, AUTHOR, "harassment", null, "the real text"]);
    expect(result.alreadyReported).toBe(false);
    expect(result.receipt).toMatch(/owners and admins can see this report/);
  });

  it("refuses reporting your own message", async () => {
    const client = mockClient({ [AUTHOR]: "scout" }, [liveMessage]);
    await expect(
      reportMessage(client as never, { orgId: ORG, userId: AUTHOR, messageId: MESSAGE, reason: "spam", note: null }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("a non-member cannot report", async () => {
    const client = mockClient({}, [liveMessage]);
    await expect(
      reportMessage(client as never, { orgId: ORG, userId: STUDENT, messageId: MESSAGE, reason: "spam", note: null }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("youth protection: when the author is the only admin, the reporter is told nobody else can review it", () => {
    expect(reportReceipt({ authorIsModerator: true, otherModerators: 0 })).toMatch(/only owner or admin.*trusted|trust/);
    expect(reportReceipt({ authorIsModerator: false, otherModerators: 2 })).toMatch(/cannot/);
  });
});

describe("owner/admin actions", () => {
  it("a student cannot remove a message and the database function is never called", async () => {
    const client = mockClient({ [STUDENT]: "scout" });
    await expect(
      removeMessage(client as never, { orgId: ORG, userId: STUDENT, messageId: MESSAGE, reason: "x" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(client.calls.some((c) => /moderate_remove_org_message/.test(c.sql))).toBe(false);
  });

  it("an admin removal goes through moderate_remove_org_message with the reason", async () => {
    const client = mockClient({ [ADMIN]: "admin" }, [
      [/moderate_remove_org_message/, () => ({ rows: [{ message_id: MESSAGE, org_id: ORG, removed_at: "2026-09-22" }] })],
    ]);
    const result = await removeMessage(client as never, {
      orgId: ORG,
      userId: ADMIN,
      messageId: MESSAGE,
      reason: "Not OK for a youth team",
    });
    expect(result.messageId).toBe(MESSAGE);
    const call = client.calls.find((c) => /moderate_remove_org_message/.test(c.sql))!;
    expect(call.params).toEqual([MESSAGE, "Not OK for a youth team"]);
  });

  it("a removal that resolves to another team's message is refused", async () => {
    const client = mockClient({ [ADMIN]: "owner" }, [
      [/moderate_remove_org_message/, () => ({ rows: [{ message_id: MESSAGE, org_id: "other-org", removed_at: "x" }] })],
    ]);
    await expect(
      removeMessage(client as never, { orgId: ORG, userId: ADMIN, messageId: MESSAGE, reason: null }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("students cannot see or dismiss reports", async () => {
    const client = mockClient({ [STUDENT]: "viewer" });
    await expect(listOpenReports(client as never, { orgId: ORG, userId: STUDENT })).rejects.toMatchObject({ status: 403 });
    await expect(
      dismissReport(client as never, { orgId: ORG, userId: STUDENT, reportId: MESSAGE, note: null }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("a report RLS hides from this admin (e.g. about their own message) cannot be dismissed", async () => {
    const client = mockClient({ [ADMIN]: "admin" }, [[/UPDATE org_message_reports/, () => ({ rows: [] })]]);
    await expect(
      dismissReport(client as never, { orgId: ORG, userId: ADMIN, reportId: MESSAGE, note: null }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lists private-chat reports without naming who is in the chat", async () => {
    const client = mockClient({ [ADMIN]: "admin" }, [
      [
        /FROM org_message_reports r/,
        () => ({
          rows: [
            {
              id: "r1",
              messageId: MESSAGE,
              conversationId: CONVO,
              reason: "safety",
              note: null,
              bodySnapshot: "text",
              reporterName: "Sam",
              authorName: "Alex",
              messageRemoved: false,
              conversationKind: null,
              conversationTitle: null,
              createdAt: "2026-09-22",
            },
          ],
        }),
      ],
    ]);
    const [report] = await listOpenReports(client as never, { orgId: ORG, userId: ADMIN });
    expect(report!.conversationLabel).toBe("a private chat");
    expect(report!.reasonLabel).toBe("Someone may be unsafe");
  });
});

describe("how a removed message renders", () => {
  it("others see 'Removed by a team admin'; the author sees it was theirs and why", async () => {
    const client = mockClient({}, [
      [/org_message_removal_notices/, () => ({ rows: [{ message_id: MESSAGE, removed_at: "2026-09-22", reason: "Rude" }] })],
    ]);
    const others = [{ id: MESSAGE, mine: false, deletedAt: "2026-09-22", removal: null as never }];
    await attachRemovalNotices(client as never, ORG, others);
    expect(others[0]!.removal).toMatchObject({ notice: REMOVED_BY_ADMIN_TEXT, reason: null });

    const mine = [{ id: MESSAGE, mine: true, deletedAt: "2026-09-22", removal: null as never }];
    await attachRemovalNotices(client as never, ORG, mine);
    expect(mine[0]!.removal).toMatchObject({ notice: "A team admin removed your message. Reason: Rude", reason: "Rude" });
  });

  it("a message the author deleted themself is not labelled as an admin removal", async () => {
    const client = mockClient({}, [[/org_message_removal_notices/, () => ({ rows: [] })]]);
    const list = [{ id: MESSAGE, mine: false, deletedAt: "2026-09-22", removal: undefined }];
    await attachRemovalNotices(client as never, ORG, list);
    expect(list[0]!.removal).toBeUndefined();
    expect(removalNotice({ mine: false, reason: "secret" })).toBe(REMOVED_BY_ADMIN_TEXT);
  });
});

describe("who hears about a report", () => {
  it("notifies reviewing admins, never the author or the reporter", async () => {
    const { reportNotificationRecipients } = await import("./moderation");
    expect(reportNotificationRecipients(["owner", "admin", "author"], "author", "reporter")).toEqual(["owner", "admin"]);
    expect(reportNotificationRecipients(["owner", "owner"], "someone", "owner")).toEqual([]);
  });
});
