import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleSheetsError } from "../google-sheets/google-api";
import { exportRecoveryJournal } from "./journal";
import { RetryableError } from "workflow";

const fake = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), write: vi.fn() }));
vi.mock("../provisioning/pool", () => ({ provisioningPool: () => ({ connect: async () => ({ query: fake.query, release: fake.release }) }) }));
vi.mock("../google-sheets/sheets-hub", () => ({ loadSheetsHubBridge: async () => ({}) }));
vi.mock("./sheets", () => ({ writeRecoveryRecord: fake.write }));

describe("recovery journal provider waits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes("row_to_json")) return { rows: [{ id: "9007199254740993", record: '{"id":9007199254740993,"row_data":{"value":0.1234567890123456789}}' }], rowCount: 1 };
      if (sql.includes("count(*)")) return { rows: [{ count: "1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  });
  it("leaves events unacknowledged and releases the worker before a durable daily wait", async () => {
    fake.write.mockRejectedValue(new GoogleSheetsError("throttled", "Quota used", null, "daily_quota", 7_200_000));
    const started = Date.now();
    const error = await exportRecoveryJournal().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RetryableError);
    const retryAt = (error as RetryableError).retryAfter.getTime();
    expect(retryAt).toBeGreaterThanOrEqual(started + 7_200_000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 7_200_000);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE recovery_events"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("state='failed'"))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_unlock"))).toBe(true);
    expect(fake.release).toHaveBeenCalledOnce();
    // The transport retains raw numeric data, independent of JS number precision.
    expect(JSON.parse(fake.write.mock.calls[0]![3]).events[0]).toContain("9007199254740993");
  });
  it("does not reclassify corruption as a quota wait or acknowledge failed writes", async () => {
    const error = new Error("Integrity mismatch");
    fake.write.mockRejectedValue(error);
    await expect(exportRecoveryJournal()).rejects.toBe(error);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE recovery_events"))).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
