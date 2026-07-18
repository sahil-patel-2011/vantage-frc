import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeObjectChatBridgeView } from "./compute-object-chat-bridge";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeObjectChatBridgeView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeObjectChatBridgeView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("summarizes links and notifications for a live org", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM object_chat_bridge_links") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "link-1",
              objectType: "subsystem",
              objectRef: "Intake",
              objectLabel: "Intake roller",
              threadRef: "#build-intake",
              subteam: "mechanical",
              status: "active",
              context: "Roller mount cracked during practice match.",
              seasonYear: 2026,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "link-2",
              objectType: "order",
              objectRef: "PO-4821",
              objectLabel: null,
              threadRef: "#business-orders",
              subteam: "business",
              status: "resolved",
              context: null,
              seasonYear: 2026,
              createdAt: "2026-01-15T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM object_chat_bridge_notifications")) {
        return {
          rows: [
            {
              id: "notif-1",
              linkId: "link-1",
              notifiedSubteam: "mechanical",
              message: "Need a replacement mount before Friday practice.",
              acknowledged: false,
              acknowledgedAt: null,
              createdAt: "2026-02-01T01:00:00.000Z",
            },
            {
              id: "notif-2",
              linkId: "link-2",
              notifiedSubteam: "business",
              message: "PO shipped, tracking attached.",
              acknowledged: true,
              acknowledgedAt: "2026-01-16T00:00:00.000Z",
              createdAt: "2026-01-15T12:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeObjectChatBridgeView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.links).toHaveLength(2);
    expect(view.summary.totalLinks).toBe(2);
    expect(view.summary.activeLinks).toBe(1);
    expect(view.summary.resolvedLinks).toBe(1);
    expect(view.summary.totalNotifications).toBe(2);
    expect(view.summary.unacknowledgedNotifications).toBe(1);

    const intakeLink = view.links.find((link) => link.id === "link-1");
    expect(intakeLink?.notifications).toHaveLength(1);
    expect(intakeLink?.notifications[0].acknowledged).toBe(false);

    const mechanical = view.summary.bySubteam.find((row) => row.subteam === "mechanical");
    expect(mechanical?.count).toBe(1);
  });
});
