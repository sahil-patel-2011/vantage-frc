import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  paths: [] as string[],
  queued: false,
}));

vi.mock("next/server", () => ({
  after: (work: () => unknown) => {
    void work();
  },
}));
vi.mock("@vantage/db", () => ({
  withRls: async (
    _ctx: unknown,
    work: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
  ) => work({ query: async () => ({ rows: [{ userId: USER }] }) }),
}));
vi.mock("@vantage/core", () => ({ isPlatformAdmin: async () => false }));
vi.mock("../../../../../lib/microsoft/route-helpers", () => ({
  requireUser: async () => ({ id: USER }),
  readOrgIdFromRequest: async () => ORG,
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  failJson: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "failed" }, { status: 400 }),
}));
vi.mock("../../../../../lib/microsoft/authz", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  isUuid: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
  readOrgRole: async () => "owner",
  requireWorkbookManager: async () => undefined,
  roleCanManageWorkbook: () => true,
}));
vi.mock("../../../../../lib/rate-limit", () => ({
  createRateLimiter: () => ({ allow: async () => true }),
}));
vi.mock("../../../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async (path: string) => {
    state.paths.push(path);
    if (path === "/api/cron/readable-sheets") {
      return state.queued
        ? { ok: true as const, body: { queued: true } }
        : { ok: false as const, pending: true as const, reason: "cron_unconfigured" as const };
    }
    return { ok: true as const, body: {} };
  },
}));
vi.mock("../../../../../lib/google-sheets/sheets-hub", () => ({
  loadSheetsHubBridge: async () => null,
  syncTeamToHub: async () => null,
}));
vi.mock("../../../../../lib/mirror/mirror-sync", () => ({ syncMirror: async () => undefined }));
vi.mock("../../../../../lib/mirror/mirror-targets", () => ({
  connectedTargetDefs: () => [],
  readCopyStates: async () => ({ migrated: false, copies: [] }),
}));

const { POST } = await import("./route");

function ping() {
  return POST(new Request("https://vantage.example/api/integrations/sheets/auto", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId: ORG }),
  }));
}

beforeEach(() => {
  state.paths = [];
  state.queued = false;
  vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "");
});

describe("POST /api/integrations/sheets/auto", () => {
  it("does not mark the hub queued when the cron secret is missing", async () => {
    const response = await ping();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true, hubQueued: false });
    expect(state.paths).not.toContain("/api/cron/readable-sheets");
  });

  it("reports the hub queued only when the readable-sheets cron accepts the team", async () => {
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "hub-secret");
    state.queued = true;
    const response = await ping();
    expect(await response.json()).toEqual({ queued: true, hubQueued: true });
    expect(state.paths).toContain("/api/cron/readable-sheets");
    expect(state.paths).toContain("/api/cron/recovery-journal");
  });
});
