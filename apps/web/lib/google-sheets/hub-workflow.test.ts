import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "workflow";
import { GoogleSheetsError } from "./google-api";
import { readableHubWorkflow } from "./hub-workflow";
const fake = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), write: vi.fn(), completed: {} as Record<string, unknown>, locked: true }));
vi.mock("../provisioning/pool", () => ({ provisioningPool: () => ({ connect: async () => ({ query: fake.query, release: fake.release }) }) }));
vi.mock("./sheets-hub", () => ({ loadSheetsHubBridge: async () => ({}), readHubTeam: async () => ({ key: "team" }) }));
vi.mock("../microsoft/workbook-sync", () => ({ loadWorkbookSource: async () => ({}) }));
vi.mock("../provisioning/workbooks", () => ({ provisionWorkbooks: fake.write }));

describe("durable readable Google refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks(); fake.completed = {}; fake.locked = true;
    fake.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: fake.locked }], rowCount: 1 };
      if (sql.includes("SELECT completed_workbooks")) return { rows: [{ completed: fake.completed }], rowCount: 1 };
      if (sql.includes("completed_workbooks=completed_workbooks||")) fake.completed[String(values[2])] = { sourceReadAt: values[3] };
      return { rows: [], rowCount: 0 };
    });
    fake.write.mockResolvedValue({});
  });
  it("persists each verified workspace, then advances freshness only after all five", async () => {
    await readableHubWorkflow("org", "generation");
    expect(fake.write.mock.calls.map(([, , , options]) => options.only)).toEqual(["Start Here", "Competition", "Team", "Build", "Business"]);
    expect(Object.keys(fake.completed)).toHaveLength(5);
    const ready = fake.query.mock.calls.filter(([sql]) => String(sql).includes("SET state='ready'"));
    expect(ready).toHaveLength(1);
    expect(String(ready[0]![0])).toContain("min((value->>'sourceReadAt')::timestamptz)");
    expect(String(ready[0]![0])).toContain("generation=$2::uuid AND completed_workbooks ?&");
    expect(fake.release).toHaveBeenCalledTimes(6);
  });
  it("keeps earlier verified books after interruption and resumes the remaining books", async () => {
    fake.write.mockImplementation(async (_bridge, _team, _source, options) => {
      if (options.only === "Team") throw new Error("Read-back mismatch");
      return {};
    });
    await expect(readableHubWorkflow("org", "generation")).rejects.toThrow("Read-back mismatch");
    expect(Object.keys(fake.completed)).toEqual(["Start Here", "Competition"]);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("SET state='ready'"))).toBe(false);
    fake.write.mockReset().mockResolvedValue({});
    await readableHubWorkflow("org", "generation");
    expect(fake.write.mock.calls.map(([, , , options]) => options.only)).toEqual(["Team", "Build", "Business"]);
  });
  it("releases the worker and records a real provider wait without acknowledging the failed workbook", async () => {
    const start = Date.now();
    fake.write.mockRejectedValue(new GoogleSheetsError("throttled", "Daily quota", null, "daily_quota", 7_200_000));
    const error = await readableHubWorkflow("org", "generation").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RetryableError);
    expect((error as RetryableError).retryAfter.getTime()).toBeGreaterThanOrEqual(start + 7_200_000);
    const waiting = fake.query.mock.calls.find(([sql, values]) => String(sql).includes("SET state=$3") && values[2] === "waiting");
    expect(waiting?.[1]?.[4]).toBeTruthy();
    expect(Object.keys(fake.completed)).toHaveLength(0);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("SET state='ready'"))).toBe(false);
    expect(fake.release).toHaveBeenCalledTimes(2);
  });
});
