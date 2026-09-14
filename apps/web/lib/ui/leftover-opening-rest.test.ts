import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-leaves. Hub labels stay Task board, Object chat, and
 * Cross-domain. leftover-opening-leaves Opening Playbook / Opening
 * Learning, leftover-opening-more Opening Match sim, leftover-fmea
 * Failure log, leftover-pick-before Choose your team stay. Hub My Day /
 * Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/tasks/tasks-client.tsx",
  "app/object-chat-bridge/object-chat-bridge-client.tsx",
  "app/cross-domain-alerts/cross-domain-alerts-client.tsx",
  "app/season-rollover/season-rollover-client.tsx",
] as const;

describe("leftover student opening-rest chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
    }
    const tasks = readFileSync(join(WEB, "app/tasks/tasks-client.tsx"), "utf8");
    expect(tasks).toMatch(/Opening Task board/);
    const chat = readFileSync(
      join(WEB, "app/object-chat-bridge/object-chat-bridge-client.tsx"),
      "utf8",
    );
    expect(chat).toMatch(/Opening Object chat/);
    expect(chat).toMatch(/title="Object chat"/);
    expect(chat).toMatch(/feature="Object chat"/);
    expect(chat).toMatch(/Choose your team/);
    const alerts = readFileSync(
      join(WEB, "app/cross-domain-alerts/cross-domain-alerts-client.tsx"),
      "utf8",
    );
    expect(alerts).toMatch(/Opening Cross-domain/);
    expect(alerts).toMatch(/title="Cross-domain alerts"/);
    expect(alerts).toMatch(/Choose your team/);
    const rollover = readFileSync(
      join(WEB, "app/season-rollover/season-rollover-client.tsx"),
      "utf8",
    );
    expect(rollover).toMatch(/Opening Season rollover/);
    expect(rollover).toMatch(/title="Season rollover"/);
    expect(rollover).toMatch(/Choose your team/);
  });
});
