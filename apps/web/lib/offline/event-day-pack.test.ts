import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EVENT_DAY_PACK, saveEventDayPack } from "./event-day-pack";
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
    expect(saved).toEqual(["competition", "schedule", "match-checklist"]);
    expect(result.failed).toEqual(["My Day", "Pit", "the packing list"]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/command?orgId=org-1");
  });
});
