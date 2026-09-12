import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Failure notes hub titles after leftover-strips-more.
 * leftover-fmea Failure log stays. leftover-fmea-strips no Open FMEA,
 * leftover-event-day-more Event day, leftover-cards-more Match cards,
 * leftover-hub-mismatch Impact essay, leftover-community-impact Impact,
 * leftover-invites Invites, leftover-strategy Pick list, leftover-scout-titles
 * Shifts, leftover-match-more Pick clock, leftover-event-day-titles Drive-team
 * board / Day plan stay. Hub My Day / Schema A/B stay. Routes stay. Do not
 * invent a last-snapshot.
 */
const FILES = [
  "lib/nav/hubs.ts",
  "lib/team/team-related.ts",
  "app/team/team-hub.tsx",
] as const;

describe("leftover student fmea-hub chrome", () => {
  it("does not print leftover Failure notes hub titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Failure notes/);
      expect(src, rel).not.toMatch(/Failure Notes/);
    }
    const hubs = readFileSync(join(WEB, "lib/nav/hubs.ts"), "utf8");
    expect(hubs).toMatch(/id: "fmea", label: "Failure log"/);
    expect(hubs).toMatch(/id: "command", label: "Event day"/);
    expect(hubs).toMatch(/id: "match-strategy-cards", label: "Match cards"/);
    expect(hubs).toMatch(/id: "match-delta-watcher", label: "Match delta"/);
    expect(hubs).toMatch(/id: "match-video-index", label: "Video index"/);
    expect(hubs).toMatch(/id: "video-analysis", label: "Match video"/);
    expect(hubs).toMatch(/id: "picklist-collab", label: "Pick list"/);
    expect(hubs).toMatch(/id: "shift-balancer", label: "Shifts"/);
    expect(hubs).toMatch(/id: "pick-clock", label: "Pick clock"/);
    expect(hubs).toMatch(/id: "drive-team-signals", label: "Drive-team board"/);
    expect(hubs).toMatch(/id: "event-day-plan", label: "Day plan"/);
    expect(hubs).toMatch(/id: "team-admin", label: "Invites"/);
    expect(hubs).toMatch(/id: "impact", label: "Impact"/);
    expect(hubs).toMatch(/id: "impact-essay", label: "Impact essay"/);
    expect(hubs).toMatch(/id: "skills-graph", label: "Skills"/);
    expect(hubs).toMatch(/id: "risks", label: "Risk register"/);
    expect(hubs).toMatch(/id: "build-burndown", label: "Burndown"/);
    expect(hubs).toMatch(/id: "tool-checkout", label: "Tool checkout"/);
    expect(hubs).toMatch(/id: "inspection-copilot", label: "Inspection"/);
    expect(hubs).toMatch(/id: "my-day", label: "My Day"/);
    expect(hubs).toMatch(/id: "scouting-schema-ab", label: "Schema A\/B"/);
    const related = readFileSync(join(WEB, "lib/team/team-related.ts"), "utf8");
    expect(related).toMatch(/id: "fmea", label: "Failure log"/);
    expect(related).toMatch(/id: "knowledge", label: "Playbook"/);
    const hub = readFileSync(join(WEB, "app/team/team-hub.tsx"), "utf8");
    expect(hub).toMatch(/label="Failure log"/);
    expect(hub).toMatch(/label="People"/);
    expect(hub).toMatch(/label="Batteries"/);
    expect(hub).toMatch(/label="Chat"/);
  });
});
