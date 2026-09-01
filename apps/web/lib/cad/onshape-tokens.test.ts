import { afterEach, describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { hostedOnshapeAuthFromEnv } from "./hosted-auth";
import { hostedOnshapeEnvStatus } from "./onshape-setup-status";
import { loadCadAgentOnshape } from "./onshape-tokens";

const ORIGINAL = {
  ONSHAPE_ACCESS_KEY: process.env.ONSHAPE_ACCESS_KEY,
  ONSHAPE_SECRET_KEY: process.env.ONSHAPE_SECRET_KEY,
  ONSHAPE_API_KEY: process.env.ONSHAPE_API_KEY,
  ONSHAPE_API_SECRET: process.env.ONSHAPE_API_SECRET,
  ONSHAPE_OAUTH_CLIENT_ID: process.env.ONSHAPE_OAUTH_CLIENT_ID,
  ONSHAPE_OAUTH_CLIENT_SECRET: process.env.ONSHAPE_OAUTH_CLIENT_SECRET,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function clientWithoutConnection(): PoolClient {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as PoolClient;
}

describe("hosted Onshape credential resolution", () => {
  it("refuses keys-only env as setup_required and does not treat keys as connected", async () => {
    delete process.env.ONSHAPE_OAUTH_CLIENT_ID;
    delete process.env.ONSHAPE_OAUTH_CLIENT_SECRET;
    process.env.ONSHAPE_ACCESS_KEY = "test-access";
    process.env.ONSHAPE_SECRET_KEY = "test-secret";

    expect(hostedOnshapeEnvStatus(process.env).setupRequired).toBe(true);
    expect(hostedOnshapeAuthFromEnv(process.env).connected).toBe(false);
    expect(hostedOnshapeAuthFromEnv(process.env).setupRequired).toBe(true);

    await expect(
      loadCadAgentOnshape(
        clientWithoutConnection(),
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ),
    ).rejects.toThrow(/Setup required/);
  });

  it("returns a setup error when neither hosted path exists", async () => {
    delete process.env.ONSHAPE_OAUTH_CLIENT_ID;
    delete process.env.ONSHAPE_OAUTH_CLIENT_SECRET;
    delete process.env.ONSHAPE_ACCESS_KEY;
    delete process.env.ONSHAPE_SECRET_KEY;
    delete process.env.ONSHAPE_API_KEY;
    delete process.env.ONSHAPE_API_SECRET;

    expect(hostedOnshapeEnvStatus(process.env).setupRequired).toBe(true);
    expect(hostedOnshapeEnvStatus(process.env).message).toMatch(/Setup required/);

    await expect(
      loadCadAgentOnshape(
        clientWithoutConnection(),
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ),
    ).rejects.toThrow(/Setup required/);
  });

  it("is not setup_required at the env layer when OAuth is configured, but still refuses a hosted load without a session", async () => {
    delete process.env.ONSHAPE_ACCESS_KEY;
    delete process.env.ONSHAPE_SECRET_KEY;
    delete process.env.ONSHAPE_API_KEY;
    delete process.env.ONSHAPE_API_SECRET;
    process.env.ONSHAPE_OAUTH_CLIENT_ID = "cid";
    process.env.ONSHAPE_OAUTH_CLIENT_SECRET = "csecret";

    expect(hostedOnshapeEnvStatus(process.env).setupRequired).toBe(false);
    expect(hostedOnshapeEnvStatus(process.env).configured).toBe(true);
    expect(hostedOnshapeAuthFromEnv(process.env, true).setupRequired).toBe(false);
    expect(hostedOnshapeAuthFromEnv(process.env, true).connected).toBe(true);

    await expect(
      loadCadAgentOnshape(
        clientWithoutConnection(),
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ),
    ).rejects.toThrow(/Setup required/);
  });
});
