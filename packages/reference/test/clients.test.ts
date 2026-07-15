import { describe, expect, it, vi } from "vitest";
import { StatboticsClient } from "../src/statbotics-client";
import { TbaClient } from "../src/tba-client";

describe("TbaClient", () => {
  it("sends validators and accepts a 304 without parsing a body", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-TBA-Auth-Key")).toBe("test-key");
        expect(headers.get("If-None-Match")).toBe('"fixture-etag"');
        return new Response(null, {
          status: 304,
          headers: { etag: '"fixture-etag"' },
        });
      },
    );
    const client = new TbaClient({ authKey: "test-key", fetch: fetcher });

    await expect(
      client.get("events/2026", { etag: '"fixture-etag"' }),
    ).resolves.toEqual({
      status: 304,
      data: null,
      etag: '"fixture-etag"',
      lastModified: null,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("StatboticsClient", () => {
  it("honors Retry-After and retries transient responses", async () => {
    const sleeps: number[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ team: 2337 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new StatboticsClient({
      fetch: fetcher,
      minimumIntervalMs: 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      random: () => 0,
    });

    await expect(client.get("team_years?year=2026")).resolves.toEqual([
      { team: 2337 },
    ]);
    expect(sleeps).toEqual([2_000]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
