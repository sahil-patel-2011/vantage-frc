import { describe, expect, it, vi } from "vitest";
import { StatboticsClient } from "../src/statbotics-client";
import { TbaClient } from "../src/tba-client";
import { tbaPollingInterval } from "../src/live-coordinator";
import { resolveSourceConflict } from "../src/source-registry";

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
  it("deduplicates concurrent conditional requests",async()=>{
    const fetcher=vi.fn(async()=>{await Promise.resolve();return new Response(JSON.stringify([{key:"2026test"}]),{status:200,headers:{"content-type":"application/json",etag:'"one"'}});});
    const client=new TbaClient({authKey:"redacted-fixture",fetch:fetcher});
    const [first,second]=await Promise.all([client.get("events/2026"),client.get("events/2026")]);
    expect(first).toEqual(second);expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("live ingestion policy",()=>{
 it("accelerates active events and keeps official values on conflict",()=>{
  expect(tbaPollingInterval({eventActive:true,eventWithinDays:0,sourceHealthy:true})).toBe(30_000);
  expect(tbaPollingInterval({eventActive:false,eventWithinDays:null,sourceHealthy:true})).toBe(6*60*60_000);
  const resolved=resolveSourceConflict({value:{red:120},source:"tba"},{value:{red:125},source:"qualitative-web"});
  expect(resolved.value).toEqual({red:120});expect(resolved.conflict).not.toBeNull();
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

  it("deduplicates concurrent requests for the same resource", async () => {
    let started = 0;
    const fetcher = vi.fn(async () => {
      started += 1;
      await Promise.resolve();
      return new Response(JSON.stringify([{ team: 2337 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new StatboticsClient({ fetch: fetcher, minimumIntervalMs: 0 });
    const [first, second] = await Promise.all([
      client.get("team_events?event=2026miket"),
      client.get("team_events?event=2026miket"),
    ]);
    expect(first).toEqual(second);
    expect(started).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Nexus live parse", () => {
  it("keeps missing queue fields null", async () => {
    const { parseNexusLive } = await import("../src/nexus-client");
    expect(parseNexusLive({}, "2026mi", "t")).toEqual({
      eventKey: "2026mi",
      queuedMatchKey: null,
      nowQueuing: null,
      fetchedAt: "t",
    });
    expect(parseNexusLive({ nowQueuing: "Quals 12" }, "2026mi", "t").nowQueuing).toBe("Quals 12");
  });
});
