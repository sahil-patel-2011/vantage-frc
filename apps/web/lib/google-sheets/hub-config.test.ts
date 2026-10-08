import type { PoolClient } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sheetsHubBridge, sheetsHubConfig } from "./hub-config";
import { loadSheetsHubBridge } from "./sheets-hub";

// Keep the test module graph independent of runtime database pools. The real
// savepoint helper still exercises registry-read fallback with a fake client.
vi.mock("@vantage/db", async () => import("../../../../packages/db/src/savepoint"));
vi.mock("../microsoft/workbook-sync", () => ({ loadWorkbookSource: vi.fn() }));
vi.mock("../provisioning/workbooks", () => ({ provisionWorkbooks: vi.fn() }));
vi.mock("@vantage/core/public-signup", () => ({ isLocalAcceptanceSignup: () => false }));

const URL_ENV = "https://script.google.com/macros/s/AKfycbxENV1234567890abcdefghijk/exec";
const URL_STORED = "https://script.google.com/macros/s/AKfycbxDB1234567890abcdefghijkl/exec";
const SECRET = "ab".repeat(32);

beforeEach(() => {
  vi.stubEnv("VANTAGE_SHEETS_HUB_URL", "");
  vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", SECRET);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Configuration must not contact a provider"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Google hub environment configuration", () => {
  it("uses complete environment configuration without any SQL or provider request", async () => {
    vi.stubEnv("VANTAGE_SHEETS_HUB_URL", ` ${URL_ENV} `);
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", ` ${SECRET.toUpperCase()} `);
    const query = vi.fn(async () => { throw new Error("SQL access prohibited"); });
    expect((await loadSheetsHubBridge({ query } as unknown as PoolClient))?.url).toBe(URL_ENV);
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sheetsHubConfig()).toEqual({ url: URL_ENV, secret: SECRET });
  });

  it("retains registered-address fallback for missing or invalid environment addresses", async () => {
    for (const configuredUrl of ["", "https://other.example/exec"]) {
      vi.stubEnv("VANTAGE_SHEETS_HUB_URL", configuredUrl);
      const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT url") ? [{ url: URL_STORED }] : [] }));
      expect((await loadSheetsHubBridge({ query } as unknown as PoolClient))?.url).toBe(URL_STORED);
      expect(query).toHaveBeenCalledWith("SELECT url FROM platform_sheets_hub WHERE id = 1");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps missing registry, invalid secret and missing secret unavailable", async () => {
    const query = vi.fn(async () => { throw new Error("Missing legacy registry"); });
    expect(await loadSheetsHubBridge({ query } as unknown as PoolClient)).toBeNull();
    vi.stubEnv("VANTAGE_SHEETS_HUB_URL", URL_ENV);
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "invalid");
    expect(await loadSheetsHubBridge({ query } as unknown as PoolClient)).toBeNull();
    query.mockClear();
    vi.stubEnv("VANTAGE_SHEETS_HUB_SECRET", "");
    expect(await loadSheetsHubBridge({ query } as unknown as PoolClient)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("constructs a bridge directly without a registry or granting product access", () => {
    expect(sheetsHubBridge(sheetsHubConfig({ VANTAGE_SHEETS_HUB_URL: URL_ENV, VANTAGE_SHEETS_HUB_SECRET: SECRET }))?.url).toBe(URL_ENV);
    expect(sheetsHubBridge(null)).toBeNull();
    expect(sheetsHubConfig({ VANTAGE_SHEETS_HUB_SECRET: SECRET }, "https://other.example/exec")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
