import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_WARM_CLAIM_MS, BACKGROUND_WARM_MS, EVENT_DAY_PACK, saveEventDayPack, warmEventDayInBackground } from "./event-day-pack";
import { OFFLINE_SHELL_ROUTES } from "./shell-routes";

const APP = join(__dirname, "..", "..", "app");

describe("event-day pack", () => {
  it("stores each page's response under the key that page reads", () => {
    // The pack is only useful if each page reads the key it writes. Guard the mirror.
    const clients: Record<string, string> = {
      competition: "command/command-client.tsx",
      "my-day": "my-day/my-day-client.tsx",
      schedule: "schedule/schedule-client.tsx",
      pit: "pit/pit-command-client.tsx",
      "match-checklist": "match-checklist/match-checklist-client.tsx",
      packing: "packing/packing-client.tsx",
      strategy: "strategy/strategy-client.tsx",
      briefing: "briefing/briefing-client.tsx",
    };
    for (const item of EVENT_DAY_PACK) {
      const source = readFileSync(join(APP, clients[item.feature]!), "utf8");
      expect(source, item.feature).toMatch(new RegExp(`getFeatureSnapshot(<[^>]*>)?\\(\\s*"${item.feature}"`));
      expect(source, item.feature).toContain(item.api);
    }
  });

  it("only lists pages the service worker may keep offline", () => {
    for (const item of EVENT_DAY_PACK) {
      expect(OFFLINE_SHELL_ROUTES as readonly string[], item.route).toContain(item.route);
    }
  });

  it("saves good responses, never an error or a failed request", async () => {
    const saved: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("/api/pit")) return new Response(JSON.stringify({ error: "nope" }), { status: 200 });
      if (url.startsWith("/api/packing")) throw new TypeError("offline");
      if (url.startsWith("/api/my-day")) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ status: "live" }));
    });
    const result = await saveEventDayPack("org-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      save: async (feature) => void saved.push(feature),
    });
    expect(saved).toEqual(["competition", "schedule", "match-checklist", "strategy", "briefing"]);
    expect(result.failed).toEqual(["My Day", "Pit", "the packing list"]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/command?orgId=org-1");
  });
});

describe("background warm", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  };
  const ok = vi.fn(async () => new Response(JSON.stringify({ status: "live" })));

  it("refreshes only the light pages, at most every 30 minutes per team", async () => {
    const storage = memory();
    const saved: string[] = [];
    const save = async (feature: string) => void saved.push(feature);
    let now = 1_000_000;
    const first = await warmEventDayInBackground("org-1", { now: () => now, storage, online: true, saveData: false, fetchImpl: ok as unknown as typeof fetch, save });
    expect(first.ran).toBe(true);
    expect(saved).toEqual(["competition", "my-day", "schedule"]);
    now += BACKGROUND_WARM_MS - 1;
    expect((await warmEventDayInBackground("org-1", { now: () => now, storage, online: true, saveData: false, fetchImpl: ok as unknown as typeof fetch, save })).ran).toBe(false);
    now += 2;
    expect((await warmEventDayInBackground("org-1", { now: () => now, storage, online: true, saveData: false, fetchImpl: ok as unknown as typeof fetch, save })).ran).toBe(true);
  });

  it("warms each person's copies separately on a shared device", async () => {
    const storage = memory();
    const now = 5_000_000;
    const run = (userId: string) =>
      warmEventDayInBackground("org-1", { userId, now: () => now, storage, online: true, saveData: false, fetchImpl: ok as unknown as typeof fetch, save: async () => undefined });
    expect((await run("u1")).ran).toBe(true);
    expect((await run("u1")).ran).toBe(false);
    expect((await run("u2")).ran).toBe(true);
  });

  it("lets a failed warm try again after a short claim, not 30 minutes", async () => {
    const storage = memory();
    let now = 5_000_000;
    const down = vi.fn(async () => new Response("down", { status: 503 }));
    const first = await warmEventDayInBackground("org-1", { userId: "u1", now: () => now, storage, online: true, saveData: false, fetchImpl: down as unknown as typeof fetch, save: async () => undefined });
    expect(first).toEqual({ ran: true, saved: [] });
    now += BACKGROUND_WARM_CLAIM_MS - 1;
    expect((await warmEventDayInBackground("org-1", { userId: "u1", now: () => now, storage, online: true, saveData: false, fetchImpl: down as unknown as typeof fetch })).ran).toBe(false);
    now += 2;
    expect((await warmEventDayInBackground("org-1", { userId: "u1", now: () => now, storage, online: true, saveData: false, fetchImpl: ok as unknown as typeof fetch, save: async () => undefined })).ran).toBe(true);
  });

  it("never runs offline or on a data saver connection", async () => {
    const fetchImpl = vi.fn();
    expect((await warmEventDayInBackground("org-1", { storage: memory(), online: false, fetchImpl: fetchImpl as unknown as typeof fetch })).ran).toBe(false);
    expect((await warmEventDayInBackground("org-1", { storage: memory(), online: true, saveData: true, fetchImpl: fetchImpl as unknown as typeof fetch })).ran).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
