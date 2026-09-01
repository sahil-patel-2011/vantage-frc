import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  member: true,
  instantiate: vi.fn(),
  view: {
    status: "live" as const,
    orgId: "22222222-2222-4222-8222-222222222222",
    teamNumber: 254,
    templates: [],
    runs: [],
    pitChecklist: {
      href: "/competition?tab=match-checklist&orgId=22222222-2222-4222-8222-222222222222",
      openRuns: 1,
      completedRuns: 0,
      runs: [],
    },
    summary: {
      totalTemplates: 0,
      activeTemplates: 0,
      totalRuns: 0,
      openRuns: 0,
      completedRuns: 0,
      byCategory: [],
    },
    computedAt: "2026-08-31T12:00:00.000Z",
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: { query: (sql: string) => Promise<{ rowCount: number }> }) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("FROM memberships")) {
          return { rowCount: state.member ? 1 : 0 };
        }
        return { rowCount: 0 };
      },
    }),
}));

vi.mock("./compute-checklist-library", async () => {
  const actual = await vi.importActual<typeof import("./compute-checklist-library")>("./compute-checklist-library");
  return {
    ...actual,
    computeChecklistLibraryView: async () => state.view,
    instantiatePitChecklist: (...args: unknown[]) => state.instantiate(...args),
  };
});

const { POST } = await import("../../app/api/checklist-library/route");

beforeEach(() => {
  state.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
  state.member = true;
  state.instantiate.mockReset();
  state.instantiate.mockResolvedValue({
    runId: "pit-1",
    href: state.view.pitChecklist.href,
    itemCount: 2,
    unmappedCount: 1,
  });
});

describe("POST /api/checklist-library instantiate-pit-checklist", () => {
  it("returns 401 without a session", async () => {
    state.session = null;
    const response = await POST(
      new Request("http://localhost/api/checklist-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: state.view.orgId,
          action: "instantiate-pit-checklist",
          templateId: "tmpl-1",
          matchLabel: "Qual 12",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(state.instantiate).not.toHaveBeenCalled();
  });

  it("opens a pit run from the SOP and returns the Event Day href — not a library run", async () => {
    const response = await POST(
      new Request("http://localhost/api/checklist-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: state.view.orgId,
          action: "instantiate-pit-checklist",
          templateId: "tmpl-1",
          matchLabel: "Qual 12",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { lastPitInstantiation?: { href: string; matchLabel: string } };
    expect(state.instantiate).toHaveBeenCalledTimes(1);
    expect(body.lastPitInstantiation).toEqual({
      runId: "pit-1",
      href: state.view.pitChecklist.href,
      itemCount: 2,
      unmappedCount: 1,
      matchLabel: "Qual 12",
    });
    expect(body.lastPitInstantiation?.href).toContain("tab=match-checklist");
  });

  it("rejects a missing match label before writing", async () => {
    const response = await POST(
      new Request("http://localhost/api/checklist-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: state.view.orgId,
          action: "instantiate-pit-checklist",
          templateId: "tmpl-1",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(state.instantiate).not.toHaveBeenCalled();
  });
});
