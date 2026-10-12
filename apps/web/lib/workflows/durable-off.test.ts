import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { durableWorkflowsEnabled } from "./durable";

/** VANTAGE_DURABLE_WORKFLOWS unset (the default): no Vercel Workflow is started, ever. */
const fake = vi.hoisted(() => ({
  start: vi.fn(),
  after: vi.fn(),
  provision: vi.fn(async () => undefined),
  hubSync: vi.fn(async () => undefined),
  exportJournal: vi.fn(async () => ({ state: "verified" })),
  query: vi.fn(),
  rls: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: fake.start }));
vi.mock("next/server", () => ({ after: fake.after }));
vi.mock("../provisioning/workflow", () => ({ runTeamProvisioningInline: fake.provision, teamProvisioningWorkflow: vi.fn() }));
vi.mock("../google-sheets/hub-workflow", () => ({ runReadableHubSyncInline: fake.hubSync, readableHubWorkflow: vi.fn() }));
vi.mock("../recovery/journal", () => ({ exportRecoveryJournal: fake.exportJournal }));
vi.mock("../recovery/workflow", () => ({ recoveryJournalWorkflow: vi.fn() }));
vi.mock("../recovery/readiness", () => ({ recoveryJournalReadiness: async () => "ready" }));
vi.mock("@vantage/db", () => ({ withRls: fake.rls }));
vi.mock("../provisioning/pool", () => ({
  provisioningPool: () => ({ connect: async () => ({ query: fake.query, release: () => undefined }) }),
}));
vi.mock("../google-sheets/sheets-hub", () => ({ loadSheetsHubBridge: async () => ({}) }));

const { startTeamProvisioning } = await import("../provisioning/start");
const { queueReadableHubSync } = await import("../google-sheets/hub-jobs");
const { dispatchRecoveryJournal } = await import("../recovery/dispatch");

describe("durable workflows off by default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VANTAGE_DURABLE_WORKFLOWS", "");
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "a".repeat(64));
    fake.query.mockResolvedValue({ rows: [{ org_id: "org" }], rowCount: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is on only for an explicit yes", () => {
    for (const value of ["1", "true", "on", "YES"]) expect(durableWorkflowsEnabled({ VANTAGE_DURABLE_WORKFLOWS: value })).toBe(true);
    for (const value of [undefined, "", "0", "off", "false"]) expect(durableWorkflowsEnabled({ VANTAGE_DURABLE_WORKFLOWS: value })).toBe(false);
  });

  it("runs team setup after the response instead of starting a workflow", async () => {
    expect(await startTeamProvisioning("org", "user")).toBe(true);
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.after).toHaveBeenCalledTimes(1);
    await fake.after.mock.calls[0]![0]();
    expect(fake.provision).toHaveBeenCalledWith("org");
  });

  it("runs the Google Sheets hub sync after the response instead of starting a workflow", async () => {
    expect(await queueReadableHubSync("org")).toBe(true);
    expect(fake.start).not.toHaveBeenCalled();
    await fake.after.mock.calls[0]![0]();
    expect(fake.hubSync).toHaveBeenCalledWith("org", expect.any(String));
  });

  it("exports the recovery journal once, in place, instead of starting a workflow", async () => {
    expect(await dispatchRecoveryJournal()).toEqual({ accepted: true, runId: "inline" });
    expect(fake.exportJournal).toHaveBeenCalledTimes(1);
    expect(fake.start).not.toHaveBeenCalled();
  });
});
