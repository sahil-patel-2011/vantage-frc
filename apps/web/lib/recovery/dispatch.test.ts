import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/cron/recovery-journal/route";
import { GET as readableCron } from "../../app/api/cron/readable-sheets/route";
import { queueReadableHubSync, queueDueReadableHubSyncs } from "../google-sheets/hub-jobs";

const fake = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), bridge: vi.fn(), start: vi.fn(), pending: true }));
vi.mock("../provisioning/pool", () => ({ provisioningPool: () => ({ connect: fake.connect }) }));
vi.mock("../google-sheets/sheets-hub", () => ({ loadSheetsHubBridge: fake.bridge }));
vi.mock("workflow/api", () => ({ start: fake.start }));
vi.mock("./workflow", () => ({ recoveryJournalWorkflow: vi.fn() }));
vi.mock("../google-sheets/hub-workflow", () => ({ readableHubWorkflow: vi.fn() }));

const request = () => new Request("https://vantage.test/api/cron/recovery-journal", { headers: { authorization: "Bearer local-test-cron" } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "local-test-cron");
  vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "a".repeat(64));
  fake.pending = true;
  fake.connect.mockResolvedValue({ query: fake.query, release: fake.release });
  fake.bridge.mockResolvedValue({});
  fake.start.mockResolvedValue({ runId: "test-run" });
  fake.query.mockImplementation(async (sql: string) => ({ rows: [], rowCount: sql.includes("recovery_events") && fake.pending ? 1 : 0 }));
});
afterEach(() => vi.unstubAllEnvs());

describe("scheduled runtime work", () => {
  it.each(["", "not-a-valid-secret"])("does not start jobs or open a database without a valid operator secret: %s", async secret => {
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", secret);
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ accepted: false, reason: "not_configured" });
    expect(await queueReadableHubSync("org")).toBe(false);
    expect(await queueDueReadableHubSyncs()).toEqual({ examined: 0, queued: 0, failed: 0 });
    expect((await readableCron(request())).status).toBe(200);
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("does not queue recovery or readable copies when the script address is missing", async () => {
    fake.bridge.mockResolvedValue(null);
    expect(await (await GET(request())).json()).toEqual({ accepted: false, reason: "not_configured" });
    expect(await queueReadableHubSync("org")).toBe(false);
    expect(await queueDueReadableHubSyncs()).toEqual({ examined: 0, queued: 0, failed: 0 });
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledTimes(3);
  });
  it("does not start a recovery workflow when every event is already exported", async () => {
    fake.pending = false;
    expect(await (await GET(request())).json()).toEqual({ accepted: false, reason: "current" });
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it("still queues a configured recovery with pending changes", async () => {
    const result = await GET(request());
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ accepted: true, runId: "test-run" });
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it("still dispatches due readable copies and records the workflow run", async () => {
    fake.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT o.id::text") ? [{ id: "org" }] : [], rowCount: sql.includes("RETURNING org_id") ? 1 : 0 }));
    const result = await readableCron(request());
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ examined: 1, queued: 1, failed: 0 });
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("workflow_run_id=$3"), ["org", expect.any(String), "test-run"]);
    expect(fake.release).toHaveBeenCalledTimes(2);
  });
  it("keeps failed readable dispatches visible and retryable", async () => {
    fake.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT o.id::text") ? [{ id: "org" }] : [], rowCount: sql.includes("RETURNING org_id") ? 1 : 0 }));
    fake.start.mockRejectedValueOnce(new Error("Workflow provider unavailable"));
    const result = await readableCron(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ examined: 1, queued: 0, failed: 1 });
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("state='failed'"), ["org", expect.any(String)]);
    expect(fake.release).toHaveBeenCalledTimes(2);
  });
  it("checks authorization before readiness and keeps failed reads retryable", async () => {
    expect((await GET(new Request("https://vantage.test/api/cron/recovery-journal"))).status).toBe(401);
    expect(fake.connect).not.toHaveBeenCalled();
    fake.query.mockRejectedValueOnce(new Error("Database unavailable"));
    expect((await GET(request())).status).toBe(503);
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
