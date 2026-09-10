/**
 * The Blue Alliance connector against a mocked provider.
 *
 * TBA is the connector with no OAuth dance and no callback URL: a team either
 * has a Read API v3 key or it does not. That made it the easiest one to get
 * wrong in the other direction — the failure message said "not configured" and
 * stopped, so the reader learned nothing about where the key comes from or
 * which of the three places it can go.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TbaClient } from "../src/tba-client";
import { platformTbaEnvConfigured, readPlatformTbaAuthKey } from "../src/platform-key";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

beforeEach(() => {
  delete process.env.TBA_AUTH_KEY;
  delete process.env.TBA_API_KEY;
});

describe("platform key resolution", () => {
  it("is unconfigured with neither variable set", () => {
    expect(readPlatformTbaAuthKey()).toBeNull();
    expect(platformTbaEnvConfigured()).toBe(false);
  });

  it("prefers the canonical TBA_AUTH_KEY", () => {
    process.env.TBA_AUTH_KEY = "canonical";
    process.env.TBA_API_KEY = "alias";
    expect(readPlatformTbaAuthKey()).toBe("canonical");
  });

  it("accepts TBA_API_KEY as the documented alias", () => {
    process.env.TBA_API_KEY = "alias";
    expect(readPlatformTbaAuthKey()).toBe("alias");
    expect(platformTbaEnvConfigured()).toBe(true);
  });

  it("treats a whitespace-only value as unset rather than sending a blank key", () => {
    process.env.TBA_AUTH_KEY = "   ";
    expect(readPlatformTbaAuthKey()).toBeNull();
  });
});

describe("TbaClient against a mocked The Blue Alliance", () => {
  it("refuses to construct without a key instead of sending an unauthenticated request", () => {
    expect(() => new TbaClient({ authKey: "  " })).toThrow(/auth key is required/i);
  });

  it("sends the key in X-TBA-Auth-Key, never in the URL", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const client = new TbaClient({
      authKey: "secret-key",
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init.headers) });
        return new Response(JSON.stringify({ team_number: 3005 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await client.get("team/frc3005");
    expect(seen[0]!.headers.get("X-TBA-Auth-Key")).toBe("secret-key");
    expect(seen[0]!.url).toBe("https://www.thebluealliance.com/api/v3/team/frc3005");
    expect(seen[0]!.url).not.toContain("secret-key");
  });

  it("sends If-None-Match so a repeat read costs the shared cache nothing", async () => {
    const seen: Headers[] = [];
    const client = new TbaClient({
      authKey: "k",
      fetch: (async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return new Response(null, { status: 304 });
      }) as unknown as typeof fetch,
    });

    const result = await client.get("events/2026", { etag: 'W/"abc"' });
    expect(seen[0]!.get("If-None-Match")).toBe('W/"abc"');
    expect(result.status).toBe(304);
    expect(result.data).toBeNull();
  });

  it("honours a custom base URL so a test never reaches the real, rate-limited API", async () => {
    const seen: string[] = [];
    const client = new TbaClient({
      authKey: "k",
      baseUrl: "https://tba.test/api/v3/",
      fetch: (async (url: string) => {
        seen.push(String(url));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    await client.get("/status");
    expect(seen[0]).toBe("https://tba.test/api/v3/status");
  });

  it("collapses concurrent identical reads into one upstream request", async () => {
    let calls = 0;
    const client = new TbaClient({
      authKey: "k",
      fetch: (async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await Promise.all([client.get("status"), client.get("status"), client.get("status")]);
    expect(calls).toBe(1);
  });

  it("retries a 500 and succeeds, rather than failing the whole sync on one blip", async () => {
    let calls = 0;
    const client = new TbaClient({
      authKey: "k",
      maxRetries: 2,
      random: () => 0,
      fetch: (async () => {
        calls += 1;
        if (calls === 1) return new Response("upstream", { status: 500 });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    const result = await client.get<{ ok: boolean }>("status");
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
  });

  it("gives up on a rejected key instead of hammering a shared, rate-limited API", async () => {
    let calls = 0;
    const client = new TbaClient({
      authKey: "revoked",
      maxRetries: 3,
      fetch: (async () => {
        calls += 1;
        return new Response("unauthorized", { status: 401 });
      }) as unknown as typeof fetch,
    });

    await expect(client.get("status")).rejects.toThrow();
    // A bad key is not transient. Retrying it spends someone else's quota.
    expect(calls).toBe(1);
  });
});

describe("the unconfigured message", () => {
  it("names the key source, all three places it can go, and that there is no callback URL", async () => {
    // Imported lazily: production-worker reaches the worker DB role at module
    // scope, and this assertion is about the string, not the wiring.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/production-worker.ts", import.meta.url), "utf8"),
    );
    const message = source.slice(source.indexOf("TBA Read API key is not configured"));
    expect(message).toContain("thebluealliance.com");
    expect(message).toContain("TBA_AUTH_KEY");
    expect(message).toContain("Environment Variables");
    expect(message).toContain("Admin → Live Data");
    expect(message).toContain("Team → Data");
    expect(message).toContain("no callback URL");
  });
});
