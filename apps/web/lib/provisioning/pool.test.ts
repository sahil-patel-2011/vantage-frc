import { afterEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@vantage/db/pool", () => ({
  createSqlPool: (url: string) => {
    created.urls.push(url);
    return { connect: async () => ({}) };
  },
}));

async function freshPool() {
  vi.resetModules();
  return (await import("./pool")).provisioningPool;
}

describe("provisioningPool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    created.urls = [];
  });

  it("falls back to the admin URL outside production when no worker URL is set", async () => {
    vi.stubEnv("DATABASE_WORKER_URL", "");
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://admin@localhost/vantage_test");
    vi.stubEnv("NODE_ENV", "development");
    (await freshPool())();
    expect(created.urls).toEqual(["postgres://admin@localhost/vantage_test"]);
  });

  it("prefers the worker URL, and never uses the admin URL in production", async () => {
    vi.stubEnv("DATABASE_WORKER_URL", "postgres://worker@localhost/vantage_test");
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://admin@localhost/vantage_test");
    (await freshPool())();
    expect(created.urls).toEqual(["postgres://worker@localhost/vantage_test"]);

    vi.stubEnv("DATABASE_WORKER_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await freshPool().then((pool) => () => pool())).toThrow(/not configured/);
  });
});
