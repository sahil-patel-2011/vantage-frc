import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-ops. leftover-invites Invites, leftover-pick-before Choose your
 * team, leftover-opening-admin Opening Global Team Manager, leftover-admin
 * skip-list Global Team Manager, leftover-opening-ops Opening Chat /
 * Opening Logistics, leftover-fmea Failure log stay. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "lib/workspace/workspace-join.ts",
  "lib/invite/invite-flow.ts",
  "lib/scouting/qr-handoff-related.ts",
  "lib/admin/admin-flow.ts",
  "lib/ai-keys/ai-keys-related.ts",
  "app/ai/finance-in-ai-panel.tsx",
] as const;

describe("leftover student opening-join chrome", () => {
  it("does not print leftover related Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Event Day/);
    }
    const workspace = readFileSync(join(WEB, "lib/workspace/workspace-join.ts"), "utf8");
    expect(workspace).toMatch(/Opening your team/);
    expect(workspace).toMatch(/Choose your team/);
    const invites = readFileSync(join(WEB, "lib/invite/invite-flow.ts"), "utf8");
    expect(invites).toMatch(/Opening Invites/);
    const handoff = readFileSync(join(WEB, "lib/scouting/qr-handoff-related.ts"), "utf8");
    expect(handoff).toMatch(/Opening QR handoff/);
    expect(handoff).toMatch(/Choose your team/);
    const admin = readFileSync(join(WEB, "lib/admin/admin-flow.ts"), "utf8");
    expect(admin).toMatch(/Opening Global Team Manager/);
    expect(admin).toMatch(/Global Team Manager/);
    const keys = readFileSync(join(WEB, "lib/ai-keys/ai-keys-related.ts"), "utf8");
    expect(keys).toMatch(/Opening API keys/);
    expect(keys).toMatch(/Choose your team/);
    const finance = readFileSync(join(WEB, "app/ai/finance-in-ai-panel.tsx"), "utf8");
    expect(finance).toMatch(/Opening finance settings/);
  });
});
