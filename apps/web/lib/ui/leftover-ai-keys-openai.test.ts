import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENDPOINT_EXAMPLES,
  MEMBER_KEY_BASE_URL_HINT,
  PAGE_DESCRIPTION,
} from "../../app/team/ai-keys/ai-keys-copy";
import { aiKeysBillingNote } from "../ai-keys/ai-keys-related";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student AI keys OpenAI-compatible chrome after leftover-api.
 * leftover-ai-keys extras stay. leftover-student-buttons extras stay.
 * leftover-opening-join Opening API keys stays. leftover-hub API keys stays.
 * leftover-offline AI keys stays. leftover-help Your AI keys stays.
 * leftover-offline extras and leftover-hub extras stay off leftover-ai-keys
 * FILES — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras stay
 * off leftover-ai-keys FILES. leftover-cad-change-radar extras stay off leftover-
 * ai-keys FILES. leftover-cad-setup-copy extras stay off leftover-ai-keys FILES.
 * leftover-product extras stay. leftover-api extras stay off leftover-ai-keys
 * FILES. leftover-discord extras stay off leftover-ai-keys FILES. leftover-slack
 * extras stay off leftover-ai-keys FILES. leftover-setup extras stay off leftover-
 * ai-keys FILES. leftover-related extras stay off leftover-ai-keys FILES.
 * leftover-connections extras stay off leftover-ai-keys FILES. leftover-alumni
 * extras stay off leftover-ai-keys FILES. leftover-connectors extras stay off
 * leftover-ai-keys FILES. leftover-account extras stay off leftover-ai-keys FILES.
 * leftover-student-copy extras stay. leftover-invites extras stay. leftover-pick-
 * before Choose your team stays. leftover-admin skip-list Global Team Manager
 * stays. leftover-my-day Loading My Day stays. leftover-types comments stay.
 */
const FILES = [
  "app/team/ai-keys/ai-keys-client.tsx",
  "app/team/ai-keys/page.tsx",
  "app/ai/autonomous-agent-panel.tsx",
] as const;

describe("leftover student AI keys OpenAI-compatible chrome", () => {
  it("drops leftover OpenAI-compatible and keeps leftover-ai-keys extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/OpenAI-compatible/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const client = readFileSync(join(WEB, "app/team/ai-keys/ai-keys-client.tsx"), "utf8");
    expect(client).toMatch(/Local connector encrypted and saved/);
    expect(client).toMatch(/Remove the local connector/);
    expect(client).toMatch(/title="AI keys"/);
    expect(client).toMatch(/Opening API keys/);
    const ready = readFileSync(join(WEB, "app/team/ai-keys/ai-keys-ready-view.tsx"), "utf8");
    expect(ready).toMatch(/aria-label="Bring any endpoint"/);
    expect(ready).toMatch(/aria-label="Local connector"/);
    expect(ready).toMatch(/LOCAL CONNECTOR/);
    expect(ready).toMatch(/local connector URL/);
    expect(ready).not.toMatch(/LOCAL \/ OPENAI-COMPATIBLE/);
    expect(ENDPOINT_EXAMPLES.some((example) => example.name === "Anything else")).toBe(true);
    expect(ENDPOINT_EXAMPLES.some((example) => /OpenAI-compatible/i.test(example.name))).toBe(false);
    expect(PAGE_DESCRIPTION).not.toMatch(/OpenAI-compatible/);
    expect(MEMBER_KEY_BASE_URL_HINT).not.toMatch(/OpenAI-compatible/);
    expect(aiKeysBillingNote("free").body).toMatch(/A local connector still works/);
    expect(aiKeysBillingNote("free").body).not.toMatch(/OpenAI-compatible/);
    const related = readFileSync(join(WEB, "lib/ai-keys/ai-keys-related.ts"), "utf8");
    expect(related).toMatch(/Opening API keys/);
    expect(related).toMatch(/Choose your team/);
    const hubs = readFileSync(join(WEB, "lib/nav/hubs.ts"), "utf8");
    expect(hubs).toMatch(/id: "ai-keys", label: "API keys"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/ai-keys"\)\) return "AI keys"/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Your AI keys"/);
  });
});
