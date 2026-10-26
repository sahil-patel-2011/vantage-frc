import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ eventDay: 0, dossier: 0 }));

vi.mock("../../../../lib/reference/run-ingest", () => ({
  assertCronAuthorized: (request: Request) =>
    request.headers.get("authorization") === "Bearer secret"
      ? null
      : Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("../../../../lib/reference/worker-ingest", () => ({
  runTbaEventDaySync: async () => {
    calls.eventDay += 1;
    return { matches: 2, teams: 1 };
  },
  runTbaSeasonSync: async () => ({ matches: 0 }),
  runTeamYearHistorySync: async () => ({ years: 0 }),
  runEventDirectory: async () => 4,
  runOnDemandEventRefresh: async () => "refreshed",
}));
vi.mock("../../../../lib/team-dossier/refresh", () => ({
  buildClaimedDossier: async () => {
    calls.dossier += 1;
    return "ready" as const;
  },
}));
vi.mock("../../../../lib/security/public-error", () => ({
  publicErrorMessage: () => "Reference refresh failed",
}));

const { POST } = await import("./route");

function post(body: unknown, authorization?: string) {
  return POST(new Request("https://vantage.example/api/cron/reference-refresh", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/cron/reference-refresh", () => {
  it("refuses a request without the cron secret", async () => {
    const response = await post({ kind: "event-day" });
    expect(response.status).toBe(401);
    expect(calls.eventDay).toBe(0);
  });

  it("runs the event-day worker only after the secret check", async () => {
    const response = await post({ kind: "event-day", eventKeys: ["2026test"] }, "Bearer secret");
    expect(await response.json()).toEqual({ summary: { matches: 2, teams: 1 } });
    expect(calls.eventDay).toBe(1);
  });

  it("builds a claimed dossier for a team job", async () => {
    const response = await post(
      { kind: "team-dossier", orgId: "11111111-1111-4111-8111-111111111111", teamNumber: 1111 },
      "Bearer secret",
    );
    expect(await response.json()).toEqual({ status: "ready" });
    expect(calls.dossier).toBe(1);
  });

  it("rejects a dossier job with a non-integer team number", async () => {
    const response = await post(
      { kind: "team-dossier", orgId: "11111111-1111-4111-8111-111111111111", teamNumber: 11.5 },
      "Bearer secret",
    );
    expect(response.status).toBe(400);
  });
});
