import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BYOK_PROVIDERS } from "../ai-keys/byok-providers";
import {
  CONNECT_COST_LABELS,
  CONNECT_TOOL_PROVIDERS,
  SUPPORTED_TEAM_TOOL_KEYS,
  buildConnectToolSaveRequest,
  connectToolTakesKey,
  memberKeyFor,
  savedKeyLabel,
} from "./connect-tools";

const ORG = "22222222-2222-4222-8222-222222222222";
const repo = resolve(__dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");

describe("Connect tools provider list", () => {
  it("offers only providers the existing key APIs store", () => {
    for (const provider of CONNECT_TOOL_PROVIDERS) {
      const storage = provider.storage;
      if (storage.kind === "team-tool") {
        expect(SUPPORTED_TEAM_TOOL_KEYS, provider.id).toContain(storage.tool);
      } else if (storage.kind === "member-llm") {
        expect(BYOK_PROVIDERS as readonly string[], provider.id).toContain(storage.provider);
        // The ai-keys route only stores a base URL on provider "openai".
        if (storage.baseUrl) {
          expect(storage.provider, provider.id).toBe("openai");
          expect(storage.baseUrl.startsWith("https://"), provider.id).toBe(true);
          expect(storage.model?.trim(), `${provider.id} needs a model for its endpoint`).toBeTruthy();
        }
      } else {
        expect(storage.kind).toBe("platform");
      }
    }
  });

  it("matches what the routes and the database actually accept", () => {
    // tool-keys route and 0667 CHECK both name exactly the tools we offer.
    const toolRoute = read("apps/web/app/api/organizations/tool-keys/route.ts");
    const toolMigration = read("packages/db/migrations/0667_org_tool_keys.sql");
    for (const tool of SUPPORTED_TEAM_TOOL_KEYS) {
      expect(toolRoute).toContain(`body.tool !== "${tool}"`);
      expect(toolMigration).toContain(`tool IN ('${tool}')`);
    }
    // Personal keys go through the existing save_member_key action.
    expect(read("apps/web/app/api/organizations/ai-keys/route.ts")).toContain('action === "save_member_key"');
  });

  it("gives every entry an allowed cost label, a checked source, and a one-sentence skip consequence", () => {
    for (const provider of CONNECT_TOOL_PROVIDERS) {
      expect(CONNECT_COST_LABELS as readonly string[], provider.id).toContain(provider.cost);
      expect(provider.costNote.trim().length, provider.id).toBeGreaterThan(10);
      expect(provider.sources.length, provider.id).toBeGreaterThan(0);
      for (const url of provider.sources) expect(url, provider.id).toMatch(/^https:\/\//);
      expect(provider.skipConsequence, provider.id).toMatch(/^Skip for now — [^.]+\.$/);
    }
  });

  it("does not claim a provider is plain Free unless nothing is limited or paid", () => {
    const free = CONNECT_TOOL_PROVIDERS.filter((provider) => provider.cost === "Free").map((p) => p.id);
    expect(free).toEqual(["tba"]);
  });

  it("shows TBA as provided by Vantage with no key input (no per-team TBA key route exists)", () => {
    const tba = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "tba");
    expect(tba?.storage.kind).toBe("platform");
    expect(tba && connectToolTakesKey(tba)).toBe(false);
    expect(tba?.costNote).toMatch(/Provided by Vantage/);
  });

  it("says what skipping TinyFish costs", () => {
    const tinyfish = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "tinyfish");
    expect(tinyfish?.skipConsequence).toBe(
      "Skip for now — web research in Ask AI stays off until a TinyFish key is added.",
    );
  });
});

describe("save requests use the existing routes", () => {
  it("sends TinyFish to the team tool-keys route", () => {
    const tinyfish = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "tinyfish")!;
    expect(buildConnectToolSaveRequest(tinyfish, ORG, "  sk-tinyfish-abc  ")).toEqual({
      url: "/api/organizations/tool-keys",
      body: { orgId: ORG, tool: "tinyfish", apiKey: "sk-tinyfish-abc" },
    });
  });

  it("sends Groq as a personal OpenAI-compatible key with its base URL and model", () => {
    const groq = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "groq")!;
    expect(buildConnectToolSaveRequest(groq, ORG, "gsk_x")).toEqual({
      url: "/api/organizations/ai-keys",
      body: {
        orgId: ORG,
        action: "save_member_key",
        provider: "openai",
        apiKey: "gsk_x",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
      },
    });
  });

  it("has nothing to save for a platform-provided row", () => {
    const tba = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "tba")!;
    expect(buildConnectToolSaveRequest(tba, ORG, "anything")).toBeNull();
  });
});

describe("saved-key status never shows a key", () => {
  it("tells Mistral and Groq apart by base URL in the shared slot", () => {
    const mistral = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "mistral")!;
    const groq = CONNECT_TOOL_PROVIDERS.find((provider) => provider.id === "groq")!;
    const rows = [{ provider: "openai", baseUrl: "https://api.groq.com/openai/v1/", model: null, createdAt: null }];
    expect(memberKeyFor(groq, rows)).not.toBeNull();
    expect(memberKeyFor(mistral, rows)).toBeNull();
  });

  it("uses only a short hint, and drops anything that is not one", () => {
    expect(savedKeyLabel({ hint: "ab12", verified: true })).toBe(
      "Saved: a key ending …ab12, checked with the provider. The key itself is never shown again.",
    );
    expect(savedKeyLabel({ hint: "sk-tinyfish-full-key" })).not.toContain("sk-tinyfish");
  });
});
