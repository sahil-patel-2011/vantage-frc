import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provenanceEndpointLabel } from "../../components/ui/model-provenance-policy";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help OpenAI-compatible chrome after leftover-ai-keys-openai.
 * leftover-help extras stay. leftover-help-emdash extras stay. leftover-help-
 * compound extras stay. leftover-help-compound-more Your AI keys stays.
 * leftover-ai-keys extras stay. leftover-ai-keys-openai extras stay.
 * leftover-opening-join Opening API keys stays. leftover-hub API keys stays.
 * leftover-offline AI keys stays. leftover-offline extras and leftover-hub extras
 * stay off leftover-help FILES — do not gold leftover-hub + leftover-offline
 * pairs together. leftover-cad extras stay off leftover-help FILES. leftover-cad-
 * change-radar extras stay off leftover-help FILES. leftover-cad-setup-copy extras
 * stay off leftover-help FILES. leftover-product extras stay. leftover-api extras
 * stay off leftover-help FILES. leftover-discord extras stay off leftover-help
 * FILES. leftover-slack extras stay off leftover-help FILES. leftover-setup extras
 * stay off leftover-help FILES. leftover-related extras stay off leftover-help
 * FILES. leftover-connections extras stay off leftover-help FILES. leftover-alumni
 * extras stay off leftover-help FILES. leftover-connectors extras stay off leftover-
 * help FILES. leftover-account extras stay off leftover-help FILES. leftover-student-
 * buttons extras stay. leftover-student-copy extras stay. leftover-invites extras
 * stay. leftover-pick-before Choose your team stays. leftover-admin skip-list Global
 * Team Manager stays. leftover-my-day Loading My Day stays. leftover-types comments
 * stay.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student Help OpenAI-compatible chrome", () => {
  it("drops leftover OpenAI-compatible and keeps leftover-help extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/OpenAI-compatible/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Your AI keys"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
    expect(articles).toMatch(/local connector/);
    const fail = readFileSync(join(WEB, "lib/metered-ai-fail.ts"), "utf8");
    expect(fail).not.toMatch(/OpenAI-compatible/);
    expect(fail).toMatch(/local connector/);
    expect(fail).toMatch(/Paste an OpenAI, Anthropic, or Google key, or a local connector/);
    const provenance = readFileSync(join(WEB, "components/ui/model-provenance-policy.ts"), "utf8");
    expect(provenance).not.toMatch(/OpenAI-compatible/);
    expect(provenanceEndpointLabel({ provider: "openai-compatible" })).toBe("local connector");
    const hubs = readFileSync(join(WEB, "lib/nav/hubs.ts"), "utf8");
    expect(hubs).toMatch(/id: "ai-keys", label: "API keys"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/ai-keys"\)\) return "AI keys"/);
  });
});
