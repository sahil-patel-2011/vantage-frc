import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeCadReviewQueueView } from "./compute-cad-review-queue";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCadReviewQueueView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCadReviewQueueView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from queued items and their sign-offs", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM cad_review_queue_items") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              partName: "Intake roller bracket",
              description: "CNC aluminum bracket",
              checkpoint: "fit_check",
              status: "pending",
              cadLink: "https://cad.onshape.com/documents/abc",
              priority: "high",
              submittedBy: USER,
              requiredSignoffs: 2,
              seasonYear: 2026,
              notes: null,
              createdAt: "2026-02-01T00:00:00.000Z",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM cad_review_queue_signoffs")) {
        return {
          rows: [
            {
              id: "signoff-1",
              itemId: ITEM_ID,
              reviewerId: USER,
              decision: "approved",
              comment: "Looks good",
              createdAt: "2026-02-02T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeCadReviewQueueView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.partName).toBe("Intake roller bracket");
    expect(view.items[0]?.signoffs).toHaveLength(1);
    expect(view.summary.totalItems).toBe(1);
    expect(view.summary.pendingCount).toBe(1);
  });
});
