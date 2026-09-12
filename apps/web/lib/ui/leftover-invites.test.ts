import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Team admin titles after leftover-visit-invites.
 * Hub label stays Invites. leftover-pick-before connect GitHub under
 * Invites, leftover-join-or-pick Choose your team, leftover-help-workspace
 * Connect TBA, leftover-event-day-more Event day, leftover-community-impact
 * Impact, leftover-visit-invites Visit invites, leftover-ops-more Skills /
 * Risk register / Burndown, leftover-fmea Failure log stay. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/team-admin-client.tsx",
  "app/team/admin/page.tsx",
  "lib/team/team-admin-related.ts",
  "lib/offline/shell-routes.ts",
  "lib/help/articles.ts",
  "lib/help/section-help.ts",
  "lib/github/github-related.ts",
  "lib/billing/ai-budgets-related.ts",
  "lib/ai-governance/ai-governance-related.ts",
  "lib/account/connections-related.ts",
  "lib/account/account-api-related.ts",
  "app/code/code-bugbot-panel.tsx",
  "app/code/code-client.tsx",
  "app/team/security/capabilities-client.tsx",
  "app/team/security/hub-access-client.tsx",
  "app/team/posture/posture-client.tsx",
  "app/team/security/policy-client.tsx",
  "app/team/background/background-client.tsx",
  "app/team/background/page.tsx",
  "app/team/ai-keys/ai-keys-chrome.tsx",
  "app/team/slack/slack-client.tsx",
  "app/account/appearance-panel.tsx",
  "app/messages/messages-ready-view.tsx",
  "app/api/code/route.ts",
  "lib/connectors/load-connector-status.ts",
  "lib/nav/product-nav.ts",
  "lib/nav/command-search.ts",
  "lib/nav/settings-nav.ts",
  "app/team/team-admin-model.ts",
] as const;

describe("leftover student invites chrome", () => {
  it("does not print leftover Team admin student titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const client = readFileSync(join(WEB, "app/team/team-admin-client.tsx"), "utf8");
    expect(client).toMatch(/title="Invites"/);
    expect(client).toMatch(/feature="Invites"/);
    const related = readFileSync(join(WEB, "lib/team/team-admin-related.ts"), "utf8");
    expect(related).toMatch(/Opening Invites/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/\bPick a team\b/);
    const bugbot = readFileSync(join(WEB, "app/code/code-bugbot-panel.tsx"), "utf8");
    expect(bugbot).toMatch(/connect GitHub under Invites/);
    expect(bugbot).not.toMatch(/\bPick a team\b/);
    const github = readFileSync(join(WEB, "lib/github/github-related.ts"), "utf8");
    expect(github).toMatch(/Choose your team/);
    expect(github).not.toMatch(/Code Coach/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    const help = readFileSync(join(WEB, "lib/help/section-help.ts"), "utf8");
    expect(help).toMatch(/Failure log/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/team\/admin"\)\) return "Invites"/);
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
