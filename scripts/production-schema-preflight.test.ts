import { describe, expect, it, vi } from "vitest";
import { checkProductionSchema, REQUIRED_PRODUCTION_MIGRATIONS } from "./production-schema-preflight.mjs";

const production = { VERCEL_ENV: "production", DATABASE_ADMIN_URL: "postgresql://migration:private@remote.example/vantage" };
function database(ids = REQUIRED_PRODUCTION_MIGRATIONS) {
  const client = { query: vi.fn(async () => ({ rows: ids.map((id: string) => ({ id })) })), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) };
  return { client, pool, createPool: vi.fn(() => pool) };
}

describe("production schema deployment gate", () => {
  it("keeps local and preview builds database-free even with connection variables", async () => {
    const db = database();
    for (const VERCEL_ENV of [undefined, "preview", "development"]) {
      expect(await checkProductionSchema({ env: { ...production, VERCEL_ENV }, createPool: db.createPool })).toEqual({ checked: false });
    }
    expect(db.createPool).not.toHaveBeenCalled();
  });
  it("fails before acquiring a connection when production configuration is missing", async () => {
    const db = database();
    await expect(checkProductionSchema({ env: { VERCEL_ENV: "production" }, createPool: db.createPool })).rejects.toThrow("configured migration connection");
    expect(db.createPool).not.toHaveBeenCalled();
  });
  it("rejects invalid URLs without printing their contents", async () => {
    const db = database();
    await expect(checkProductionSchema({ env: { ...production, DATABASE_ADMIN_URL: "private-secret" }, createPool: db.createPool })).rejects.toThrow("invalid migration connection");
    expect(db.createPool).not.toHaveBeenCalled();
  });
  it("prohibits a laptop database for deployment checks", async () => {
    const db = database();
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      await expect(checkProductionSchema({ env: { ...production, DATABASE_ADMIN_URL: `postgresql://migration@${host}/vantage` }, createPool: db.createPool })).rejects.toThrow("laptop database");
    }
    expect(db.createPool).not.toHaveBeenCalled();
  });
  it("checks the complete migration set in a read-only transaction and releases it", async () => {
    const db = database();
    expect(await checkProductionSchema({ env: production, createPool: db.createPool })).toEqual({ checked: true, migrations: REQUIRED_PRODUCTION_MIGRATIONS.length });
    expect(db.client.query.mock.calls).toEqual([["BEGIN READ ONLY"], ["SELECT id FROM public.schema_migrations WHERE id = ANY($1::text[])", [REQUIRED_PRODUCTION_MIGRATIONS]], ["ROLLBACK"]]);
    expect(db.client.release).toHaveBeenCalledOnce();
    expect(db.pool.end).toHaveBeenCalledOnce();
  });
  it("blocks deployment and names missing migrations without altering the database", async () => {
    const db = database(REQUIRED_PRODUCTION_MIGRATIONS.slice(0, 2));
    await expect(checkProductionSchema({ env: production, createPool: db.createPool })).rejects.toThrow(REQUIRED_PRODUCTION_MIGRATIONS.slice(2).join(", "));
    expect(db.client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(db.client.release).toHaveBeenCalledOnce();
    expect(db.pool.end).toHaveBeenCalledOnce();
  });
  it("redacts connection errors and closes the pool", async () => {
    const db = database();
    db.pool.connect.mockRejectedValueOnce(new Error("private password and host"));
    db.pool.end.mockRejectedValueOnce(new Error("private connection details"));
    await expect(checkProductionSchema({ env: production, createPool: db.createPool })).rejects.toThrow(/^Production schema readiness could not be verified\./);
    expect(db.pool.end).toHaveBeenCalledOnce();
  });
});
