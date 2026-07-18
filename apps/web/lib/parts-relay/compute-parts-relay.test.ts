import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computePartsRelayView } from "./compute-parts-relay";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computePartsRelayView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePartsRelayView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with listings, loans, and a summary computed from real rows", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM parts_relay_listings")) {
        return {
          rows: [
            {
              id: "listing-1",
              listingType: "need",
              partName: "775pro motor",
              category: "electrical",
              quantity: 1,
              condition: "used",
              eventKey: "2026miket",
              notes: null,
              status: "open",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
            {
              id: "listing-2",
              listingType: "offer",
              partName: "Spare wheels",
              category: "wheels",
              quantity: 4,
              condition: "new",
              eventKey: "2026miket",
              notes: null,
              status: "matched",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM parts_relay_loans")) {
        return {
          rows: [
            {
              id: "loan-1",
              listingId: "listing-2",
              direction: "lending",
              counterpartyTeam: "1114",
              partName: "Spare wheels",
              quantity: 4,
              eventKey: "2026miket",
              loanedOn: "2026-03-02",
              dueBackOn: "2026-03-04",
              returnedOn: "2026-03-03",
              status: "returned",
              notes: null,
              createdAt: "2026-03-02T00:00:00.000Z",
            },
            {
              id: "loan-2",
              listingId: null,
              direction: "borrowing",
              counterpartyTeam: "217",
              partName: "Battery",
              quantity: 1,
              eventKey: "2026miket",
              loanedOn: "2026-03-01",
              dueBackOn: "2026-03-01",
              returnedOn: null,
              status: "active",
              notes: null,
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computePartsRelayView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.listings).toHaveLength(2);
    expect(view.loans).toHaveLength(2);
    expect(view.summary.openNeeds).toBe(1);
    expect(view.summary.returnedLoans).toBe(1);
    // loan-2 is past due (2026-03-01) relative to "today" evaluated deterministically below.
    expect(view.summary.totalLoans).toBe(2);
    expect(view.summary.onTimeReturnRate).toBe(1);
  });
});
