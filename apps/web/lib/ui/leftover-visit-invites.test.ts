import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Visit Invites titles after leftover-community-impact.
 * Student title stays Visit invites. leftover-event-day-more Event day,
 * leftover-pick-a-team Choose your team, leftover-community-impact Impact,
 * leftover-ops-more Skills / Risk register / Burndown stay. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/visit-invites/visit-invites-client.tsx",
  "app/visit-invites/page.tsx",
  "lib/visit-invites/visit-related.ts",
  "lib/offline/shell-routes.ts",
  "components/visit-related.tsx",
  "app/api/visit-invites/route.ts",
] as const;

describe("leftover student visit-invites chrome", () => {
  it("does not print leftover Visit Invites student titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Visit Invites/);
    }
    const client = readFileSync(join(WEB, "app/visit-invites/visit-invites-client.tsx"), "utf8");
    expect(client).toMatch(/title="Visit invites"/);
    expect(client).toMatch(/feature="Visit invites"/);
    const related = readFileSync(join(WEB, "lib/visit-invites/visit-related.ts"), "utf8");
    expect(related).toMatch(/Opening Visit invites/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).toMatch(/Open Event day/);
    expect(related).toMatch(/Event day/);
    expect(related).not.toMatch(/Event Day/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/visit-invites"\)\) return "Visit invites"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact"\)\) return "Impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
  });
});
