import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { statusFor, summarizeToolCheckout, toolCategoryLabel } from ".";
import { computeToolCheckoutView } from "./compute-tool-checkout";
import type { ToolCheckoutLoan, ToolCheckoutTool } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("statusFor / summarizeToolCheckout (pure)", () => {
  it("reads a tool with no open loan as available", () => {
    expect(statusFor(null)).toBe("available");
  });

  it("reads an open loan with a future due date as checked_out", () => {
    const loan: ToolCheckoutLoan = {
      id: "loan-1",
      borrowerName: "Ada",
      checkedOutAt: "2026-07-01T00:00:00.000Z",
      dueAt: "2099-01-01T00:00:00.000Z",
      returnedAt: null,
      notes: null,
    };
    expect(statusFor(loan, new Date("2026-07-18T00:00:00.000Z"))).toBe("checked_out");
  });

  it("reads an open loan past its due date as overdue", () => {
    const loan: ToolCheckoutLoan = {
      id: "loan-1",
      borrowerName: "Ada",
      checkedOutAt: "2026-07-01T00:00:00.000Z",
      dueAt: "2026-07-05T00:00:00.000Z",
      returnedAt: null,
      notes: null,
    };
    expect(statusFor(loan, new Date("2026-07-18T00:00:00.000Z"))).toBe("overdue");
  });

  it("summarizes counts and category breakdowns", () => {
    const tools: ToolCheckoutTool[] = [
      {
        id: "t1",
        name: "Drill",
        category: "power_tool",
        assetTag: null,
        location: null,
        notes: null,
        active: true,
        status: "available",
        currentLoan: null,
        loanHistory: [],
      },
      {
        id: "t2",
        name: "Caliper",
        category: "measurement",
        assetTag: null,
        location: null,
        notes: null,
        active: true,
        status: "overdue",
        currentLoan: null,
        loanHistory: [],
      },
    ];
    const summary = summarizeToolCheckout(tools);
    expect(summary.totalTools).toBe(2);
    expect(summary.availableCount).toBe(1);
    expect(summary.overdueCount).toBe(1);
    expect(summary.byCategory.length).toBe(2);
  });

  it("labels categories for display", () => {
    expect(toolCategoryLabel("power_tool")).toBe("Power tool");
    expect(toolCategoryLabel("other")).toBe("Other");
  });
});

describe("computeToolCheckoutView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeToolCheckoutView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with tool status derived from loan rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM tool_checkout_tools")) {
        return {
          rows: [
            { id: "tool-1", name: "Drill", category: "power_tool", assetTag: "PT-1", location: "Shop A", notes: null, active: true },
            { id: "tool-2", name: "Caliper", category: "measurement", assetTag: null, location: null, notes: null, active: true },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM tool_checkout_loans")) {
        return {
          rows: [
            {
              id: "loan-1",
              toolId: "tool-1",
              borrowerName: "Ada",
              checkedOutAt: "2026-07-01T00:00:00.000Z",
              dueAt: "2026-07-05T00:00:00.000Z",
              returnedAt: null,
              notes: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeToolCheckoutView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.tools).toHaveLength(2);
      const drill = view.tools.find((t) => t.id === "tool-1");
      expect(drill?.status).toBe("overdue");
      expect(drill?.currentLoan?.borrowerName).toBe("Ada");
      const caliper = view.tools.find((t) => t.id === "tool-2");
      expect(caliper?.status).toBe("available");
      expect(view.summary.totalTools).toBe(2);
      expect(view.summary.overdueCount).toBe(1);
      expect(view.summary.availableCount).toBe(1);
    }
  });
});
