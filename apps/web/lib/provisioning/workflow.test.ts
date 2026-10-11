import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  bridge: null as null | Record<string, unknown>,
  completed: ["team", "tools"] as string[],
}));
vi.mock("./pool", () => ({ provisioningPool: () => ({ connect: async () => ({ query: fake.query, release: fake.release }) }) }));
vi.mock("../google-sheets/sheets-hub", () => ({ loadSheetsHubBridge: async () => fake.bridge, readHubTeam: async () => ({ key: "team" }) }));
vi.mock("../microsoft/workbook-sync", () => ({ loadWorkbookSource: async () => ({}) }));
vi.mock("../recovery/sheets", () => ({ readRecoveryRecord: async () => "{}" }));
vi.mock("./defaults", () => ({ initializeTeamDefaults: vi.fn(async () => undefined) }));
vi.mock("./recovery-boundary", () => ({ ensureRecoveryBoundary: async () => new Date() }));
vi.mock("./provider-wait", () => ({ recordProviderWait: async () => null }));
vi.mock("./workbooks", () => ({ provisionWorkbooks: vi.fn(), verifyWorkbookLayout: vi.fn(), verifyWorkbookTables: vi.fn(), workspaceWorkbooks: () => [] }));

const { teamProvisioningWorkflow } = await import("./workflow");

const sql = () => fake.query.mock.calls.map(([text]) => String(text));

describe("team provisioning on a server without Google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.bridge = null;
    fake.completed = ["team", "tools"];
    fake.query.mockImplementation(async (text: string) => {
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }], rowCount: 1 };
      if (text.includes("SELECT completed_phases")) return { rows: [{ completed: fake.completed }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  });

  it("marks the Google steps as connect-later instead of failing or retrying", async () => {
    await expect(teamProvisioningWorkflow("org-1")).resolves.toBeUndefined();
    const statements = sql();
    const deferred = statements.filter((text) => text.includes("'google','not_connected'"));
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toContain("state='waiting'");
    expect(deferred[0]).toContain("retry_after_at=NULL");
    // Never marked failed, never shown as running a Google step, no later step attempted.
    expect(statements.some((text) => text.includes("state='failed'"))).toBe(false);
    expect(statements.some((text) => text.includes("state='running'"))).toBe(false);
    expect(fake.query.mock.calls.filter(([text]) => String(text).includes("pg_try_advisory_lock"))).toHaveLength(3);
    // Each step released its connection and lock.
    expect(statements.filter((text) => text.includes("pg_advisory_unlock"))).toHaveLength(3);
    expect(fake.release).toHaveBeenCalledTimes(3);
  });

  it("still records a real failure as failed", async () => {
    fake.bridge = { ping: async () => ({ version: 0 }) };
    await expect(teamProvisioningWorkflow("org-1")).rejects.toThrow(/bridge needs an update/);
    expect(sql().some((text) => text.includes("SET state='failed'"))).toBe(true);
    expect(sql().some((text) => text.includes("'google','not_connected'"))).toBe(false);
  });
});
