import type { ResolvedModelSource } from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeChatAvailability, type ModelProbe } from "./capabilities";
import { ChatSendBlockedError, chatConnectionForBlock, chatSendBlock } from "./chat-send-gate";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";

type Fixture = {
  tier?: "free" | "starter" | "team" | null;
  /** org_llm_keys rows (a team key). */
  teamKey?: boolean;
  /** org_provider_configs rows. */
  providerConfigs?: Array<{ kind: string; baseUrl: string | null; localRelay: boolean }>;
  teamNumber?: number | null;
  bridgeOnline?: boolean;
};

/** The member's RLS client, answering by SQL shape — shared by the gate, the check and meteredAI. */
function fixtureClient(fixture: Fixture) {
  const calls: string[] = [];
  const empty = { rows: [], rowCount: 0 };
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ locked: true }], rowCount: 1 };
    if (/UNION ALL/.test(sql)) {
      const any = Boolean(fixture.teamKey) || Boolean(fixture.providerConfigs?.length);
      return any ? { rows: [{ "?column?": 1 }], rowCount: 1 } : empty;
    }
    if (/FROM org_billing/.test(sql)) {
      if (fixture.tier === null) return empty;
      return {
        rows: [{
          tier: fixture.tier ?? "free",
          credit_cap_usd: "0",
          kill_switch: false,
          period_start: new Date("2026-09-01"),
          period_end: new Date("2026-12-01"),
        }],
        rowCount: 1,
      };
    }
    if (/FROM org_provider_configs/.test(sql)) return { rows: fixture.providerConfigs ?? [], rowCount: fixture.providerConfigs?.length ?? 0 };
    if (/FROM org_llm_keys/.test(sql)) return fixture.teamKey ? { rows: [{ "?column?": 1 }], rowCount: 1 } : empty;
    if (/FROM organizations/.test(sql)) return { rows: [{ teamNumber: fixture.teamNumber ?? 6925 }], rowCount: 1 };
    if (/FROM ai_bridge_devices/.test(sql)) return fixture.bridgeOnline ? { rows: [{ "?column?": 1 }], rowCount: 1 } : empty;
    return empty;
  });
  return { query, calls };
}

/** The provider `meteredAI` sees for a turn answered from each resolver source. */
const PROVIDER_FOR: Record<string, string> = {
  "member-key": "anthropic",
  "org-key": "anthropic",
  "local-connector": "openai-compatible",
  hosted: "openai-compatible",
  sponsored: "openai-compatible",
  "public-swarm": "ai_horde",
  gift: "vantage-gift",
  "subscription-bridge": "subscription-bridge",
};

/** What meteredAI does with that turn: refused for want of a connection, or let through. */
async function meteredVerdict(fixture: Fixture, source: ResolvedModelSource): Promise<"refused" | "promo_expired" | "allowed"> {
  const client = fixtureClient(fixture);
  try {
    await meteredAI({
      client: client as never,
      orgId: ORG,
      userId: USER,
      feature: "chat",
      requestId: crypto.randomUUID(),
      estimatedCostUsd: 0.001,
      provider: PROVIDER_FOR[source],
      model: "test-model",
      invoke: async () => {
        throw new Error("INVOKED");
      },
    });
    return "allowed";
  } catch (error) {
    // CommitAndThrowError carries the real refusal as `publicError`.
    const inner = (error as { publicError?: unknown }).publicError ?? error;
    const message = inner instanceof Error ? inner.message : String(inner);
    if (/must configure a BYO AI key/.test(message)) return "refused";
    if (/sponsored_promo_expired/.test(message) || (inner as { reason?: string }).reason === "sponsored_promo_expired") return "promo_expired";
    return "allowed";
  }
}

async function gateVerdict(fixture: Fixture, source: ResolvedModelSource): Promise<"refused" | "promo_expired" | "allowed"> {
  const block = await chatSendBlock(fixtureClient(fixture) as never, { orgId: ORG, source });
  if (!block) return "allowed";
  return block.reason === "sponsored_promo_expired" ? "promo_expired" : "refused";
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("chatSendBlock agrees with meteredAI", () => {
  const TEAM_KEY_ROW: Fixture["providerConfigs"] = [{ kind: "openai-compatible", baseUrl: "https://api.example.com/v1", localRelay: false }];
  const cases: Array<[string, Fixture, ResolvedModelSource]> = [
    // The audited bug: a personal key (or the free pool) on a free team with no team key.
    ["personal key, free team, no team key", { tier: "free" }, "member-key"],
    ["free OpenRouter pool, free team, no team key", { tier: "free" }, "hosted"],
    ["personal key, free team that has a team key", { tier: "free", teamKey: true }, "member-key"],
    ["personal key, free team with a custom provider", { tier: "free", providerConfigs: TEAM_KEY_ROW }, "member-key"],
    ["team key, free team", { tier: "free", teamKey: true }, "org-key"],
    ["personal key, paid team", { tier: "team" }, "member-key"],
    ["hosted key, paid team", { tier: "starter" }, "hosted"],
    ["volunteer swarm, free team", { tier: "free" }, "public-swarm"],
    ["platform gift, free team", { tier: "free" }, "gift"],
    ["paired computer, free team", { tier: "free" }, "subscription-bridge"],
  ];
  for (const [name, fixture, source] of cases) {
    it(name, async () => {
      expect(await gateVerdict(fixture, source)).toBe(await meteredVerdict(fixture, source));
    });
  }

  it("refuses exactly the turns meteredAI refuses", async () => {
    expect(await gateVerdict({ tier: "free" }, "member-key")).toBe("refused");
    expect(await gateVerdict({ tier: "free" }, "hosted")).toBe("refused");
    expect(await gateVerdict({ tier: "free", teamKey: true }, "member-key")).toBe("allowed");
  });

  it("team 1111's sponsored window: open lets the free pool through, closed refuses it", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "test-only");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const sponsored: Fixture = { tier: "free", teamNumber: 1111 };
    expect(await gateVerdict(sponsored, "hosted")).toBe("allowed");
    expect(await meteredVerdict(sponsored, "hosted")).toBe("allowed");
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    expect(await gateVerdict(sponsored, "hosted")).toBe("promo_expired");
    expect(await meteredVerdict(sponsored, "hosted")).toBe("promo_expired");
  });

  it("never runs a query for a team key, a swarm, a gift or a paired computer", async () => {
    for (const source of ["org-key", "local-connector", "public-swarm", "gift", "subscription-bridge"] as const) {
      const client = fixtureClient({ tier: "free" });
      expect(await chatSendBlock(client as never, { orgId: ORG, source })).toBeNull();
      expect(client.calls).toEqual([]);
    }
  });
});

describe("probeChatAvailability answers what Send would do", () => {
  const memberKey: ModelProbe = { ok: true, source: "member-key", provider: "anthropic", model: "claude-test" };
  const noModel: ModelProbe = { ok: false, reason: "no_model_provider", message: "No AI provider key is configured for this organization." };
  const probe = (fixture: Fixture, model: ModelProbe, role = "scout") =>
    probeChatAvailability(fixtureClient(fixture) as never, { orgId: ORG, userId: USER, role }, { probeModel: async () => model });

  it("a personal key on a free team with no team connection is not 'configured'", async () => {
    const member = await probe({ tier: "free" }, memberKey);
    expect(member).toMatchObject({ configured: false, reason: "team_connection_required", nextStep: "ask_owner" });
    expect(member.message).toMatch(/team has its own AI connection/);
    const owner = await probe({ tier: "free" }, memberKey, "owner");
    expect(owner).toMatchObject({ configured: false, nextStep: "team" });
  });

  it("the same key is ready once the team has its own key, or on a paid team", async () => {
    expect(await probe({ tier: "free", teamKey: true }, memberKey)).toMatchObject({ configured: true });
    expect(await probe({ tier: "team" }, memberKey)).toMatchObject({ configured: true });
  });

  it("a member's online paired computer answers first, so it is ready even when a key would be refused", async () => {
    expect(await probe({ tier: "free", bridgeOnline: true }, memberKey)).toMatchObject({ configured: true });
    expect(await probe({ tier: "free", bridgeOnline: true }, noModel)).toMatchObject({ configured: true });
  });

  it("no model: offers the in-chat dialog only where a personal key would be allowed to answer", async () => {
    expect(await probe({ tier: "team" }, noModel)).toMatchObject({ configured: false, reason: "no_model_provider", nextStep: "connect" });
    expect(await probe({ tier: "free" }, noModel)).toMatchObject({ configured: false, reason: "no_model_provider", nextStep: "ask_owner" });
    expect(await probe({ tier: "free" }, noModel, "admin")).toMatchObject({ nextStep: "team" });
  });

  it("no billing account says AI isn't turned on, with no button to press", async () => {
    expect(await probe({ tier: null }, memberKey)).toMatchObject({ configured: false, reason: "missing_context:billing_account", nextStep: "none" });
  });
});

describe("the send path's refusal", () => {
  it("is a provider-setup error carrying the check's words and next step", () => {
    const block = { reason: "team_connection_required" as const, message: "This team doesn't have its own AI connection yet, so Ask AI can't answer." };
    const error = new ChatSendBlockedError(block);
    expect(error.name).toBe("ChatSendBlockedError");
    expect(error.message).toBe(block.message);
    expect(chatConnectionForBlock(block, "viewer")).toEqual({ configured: false, reason: block.reason, message: block.message, nextStep: "ask_owner" });
    expect(chatConnectionForBlock(block, "owner").nextStep).toBe("team");
  });
});
