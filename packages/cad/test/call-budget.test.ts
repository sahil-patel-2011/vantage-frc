import { describe, expect, it } from "vitest";
import {
  countsAgainstAnnualCap,
  createCallBudget,
  emptyCallTally,
  ledgerPath,
  mergeCallTally,
  ONSHAPE_ANNUAL_CALL_LIMITS,
} from "../src/call-budget";

function stubResponse(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

describe("Onshape call scoring", () => {
  it("charges only key/OAuth calls that Onshape answered 2xx/3xx", () => {
    // https://onshape-public.github.io/docs/auth/limits/
    expect(countsAgainstAnnualCap("session", 200)).toBe(false);
    expect(countsAgainstAnnualCap("session", 401)).toBe(false);
    expect(countsAgainstAnnualCap("api-key", 200)).toBe(true);
    expect(countsAgainstAnnualCap("api-key", 307)).toBe(true);
    expect(countsAgainstAnnualCap("api-key", 404)).toBe(false);
    expect(countsAgainstAnnualCap("api-key", 500)).toBe(false);
    expect(countsAgainstAnnualCap("oauth", 201)).toBe(true);
  });

  it("keeps the published annual caps", () => {
    expect(ONSHAPE_ANNUAL_CALL_LIMITS.free).toBe(2_500);
    expect(ONSHAPE_ANNUAL_CALL_LIMITS.professional).toBe(5_000);
    expect(ONSHAPE_ANNUAL_CALL_LIMITS.enterprise).toBe(10_000);
  });

  it("never stores a query string in the ledger path", () => {
    expect(ledgerPath("/documents?filter=0&limit=12")).toBe("/documents");
    expect(ledgerPath("https://cad.onshape.com/api/v6/users/current?x=secret")).toBe("/api/v6/users/current");
    expect(ledgerPath("users/current")).toBe("/users/current");
  });
});

describe("call budget accounting per auth path", () => {
  it("splits totals by path and only warns when a paid path is used", async () => {
    let clock = 1_000;
    const budget = createCallBudget({ now: () => (clock += 5) });
    const session = budget.attribute(async () => stubResponse(200), "session");
    for (let i = 0; i < 8; i++) await session("/partstudios/d/a/w/b/e/c/features");

    let summary = budget.summary();
    expect(summary.total).toBe(8);
    expect(summary.byAuthPath.session).toBe(8);
    expect(summary.byAuthPath["api-key"]).toBe(0);
    expect(summary.annualCapCalls).toBe(0);
    expect(summary.headline).toBe("8 session calls, 0 API-key calls — 0 charged to the Onshape annual cap");
    expect(summary.warnings).toEqual([]);

    const keyed = budget.attribute(async () => stubResponse(200), "api-key");
    await keyed("/documents?filter=0");
    summary = budget.summary();
    expect(summary.byAuthPath["api-key"]).toBe(1);
    expect(summary.annualCapCalls).toBe(1);
    expect(summary.warnings.join(" ")).toMatch(/annual allowance/i);
    expect(summary.entries.at(-1)?.path).toBe("/documents");
    expect(summary.entries.at(-1)?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not charge a failed key call, and records the status a typed error carried", async () => {
    const budget = createCallBudget();
    const failing = budget.attribute(async () => stubResponse(500), "api-key");
    await failing("/documents");

    const expiring = budget.attribute(async () => {
      throw Object.assign(new Error("expired"), { httpStatus: 401 });
    }, "session");
    await expect(expiring("/users/current")).rejects.toThrow("expired");

    const offline = budget.attribute(async () => {
      throw new Error("ECONNREFUSED");
    }, "api-key");
    await expect(offline("/documents")).rejects.toThrow("ECONNREFUSED");

    const summary = budget.summary();
    expect(summary.total).toBe(3);
    expect(summary.annualCapCalls).toBe(0);
    expect(summary.entries[1]?.status).toBe(401);
    expect(summary.entries[2]?.status).toBe(0);
  });

  it("fires the quota callback once, on the first charged call", async () => {
    const fired: number[] = [];
    const budget = createCallBudget({ onQuotaCall: (entry) => fired.push(entry.status) });
    const keyed = budget.attribute(async () => stubResponse(200), "api-key");
    await keyed("/a");
    await keyed("/b");
    expect(fired).toEqual([200]);
  });
});

describe("lifetime tally", () => {
  it("accumulates across runs and keeps the original start date", async () => {
    const budget = createCallBudget();
    const session = budget.attribute(async () => stubResponse(200), "session");
    await session("/a");
    await session("/b");
    const keyed = budget.attribute(async () => stubResponse(200), "api-key");
    await keyed("/c");

    const first = mergeCallTally(undefined, budget.summary(), "2026-01-01T00:00:00.000Z");
    expect(first).toMatchObject({ session: 2, apiKey: 1, annualCapCalls: 1, since: "2026-01-01T00:00:00.000Z" });

    budget.reset();
    const again = budget.attribute(async () => stubResponse(200), "session");
    await again("/d");
    const second = mergeCallTally(first, budget.summary(), "2026-02-01T00:00:00.000Z");
    expect(second).toMatchObject({ session: 3, apiKey: 1, annualCapCalls: 1, since: "2026-01-01T00:00:00.000Z" });
    expect(second.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(emptyCallTally("2026-01-01T00:00:00.000Z").annualCapCalls).toBe(0);
  });
});
