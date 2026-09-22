import { describe, expect, it, vi } from "vitest";
import {
  AI_AGENTS,
  probeChatModel,
  resolveAiCapabilities,
  type AiAgentStatus,
  type ModelProbe,
} from "./capabilities";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";

type Rows = Array<Record<string, unknown>>;

type Setup = {
  role?: string | null;
  hubAccess?: Rows;
  policy?: Record<string, unknown> | null;
  tinyfish?: Record<string, unknown> | null;
  github?: Record<string, unknown> | null;
  onshape?: Record<string, unknown> | null;
  fusionRelay?: Record<string, unknown> | null;
  billing?: Record<string, unknown> | null;
  usagePolicy?: Record<string, unknown> | null;
  bridgeOnline?: boolean;
};

const PROVISIONED_BILLING = {
  tier: "free",
  creditCapUsd: "0",
  killSwitch: false,
  periodStart: "2026-09-01",
  periodEnd: "2026-10-01",
};

/** A PoolClient stand-in for the member's RLS session, answering by SQL shape. */
function mockClient(setup: Setup) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    const one = (row: Record<string, unknown> | null | undefined) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    if (/FROM memberships WHERE org_id/.test(sql)) return one(setup.role === null ? null : { role: setup.role ?? "scout" });
    if (/FROM membership_hub_access/.test(sql)) return { rows: setup.hubAccess ?? [], rowCount: 0 };
    if (/FROM org_ai_policies/.test(sql)) return one(setup.policy ?? null);
    if (/FROM org_tool_keys/.test(sql)) return one(setup.tinyfish ?? null);
    if (/FROM github_connections/.test(sql)) return one(setup.github ?? null);
    if (/FROM cad_connections/.test(sql)) return one(setup.onshape ?? null);
    if (/FROM cad_relay_devices/.test(sql)) return one(setup.fusionRelay ?? null);
    if (/FROM org_billing/.test(sql)) return one(setup.billing === undefined ? PROVISIONED_BILLING : setup.billing);
    if (/FROM org_usage_policies/.test(sql)) return one(setup.usagePolicy ?? null);
    if (/FROM ai_bridge_devices/.test(sql)) return setup.bridgeOnline ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  return { query, calls };
}

const MODEL_OK: ModelProbe = { ok: true, source: "org-key", provider: "anthropic", model: "claude-test" };
const NO_MODEL: ModelProbe = { ok: false, reason: "no_model_provider", message: "No AI provider key is configured for this organization." };

async function resolve(setup: Setup, options: { model?: ModelProbe; env?: Record<string, string> } = {}) {
  const client = mockClient(setup);
  const agents = await resolveAiCapabilities(
    client as never,
    { orgId: ORG, userId: USER },
    { probeModel: async () => options.model ?? MODEL_OK, env: options.env ?? {}, now: Date.parse("2026-09-22T12:00:00Z") },
  );
  const byId = Object.fromEntries(agents.map((agent) => [agent.id, agent])) as Record<string, AiAgentStatus>;
  return { agents, byId, client };
}

describe("resolveAiCapabilities", () => {
  it("lists every registered agent, each with real registry tool ids", async () => {
    const { agents } = await resolve({});
    expect(agents.map((a) => a.id)).toEqual(AI_AGENTS.map((a) => a.id));
    const ask = AI_AGENTS.find((a) => a.id === "ask_ai")!;
    expect(ask.tools).toContain("scouting.team");
    expect(ask.writes).toBe(true);
    expect(AI_AGENTS.find((a) => a.id === "writer")!.writes).toBe(false);
  });

  it("no model provider: every model-backed agent is off with one plain sentence and a Set up link", async () => {
    const { byId } = await resolve({}, { model: NO_MODEL });
    for (const id of ["ask_ai", "autonomous_agent", "writer", "cad_brief"]) {
      expect(byId[id]!.status).toBe("unavailable");
      expect(byId[id]!.reason).toBe("no_model_provider");
      expect(byId[id]!.setupHref).toBe("/team/ai-keys");
      expect(byId[id]!.sentence.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(2);
    }
  });

  it("an online Claude Code bridge makes chat ready even with no key", async () => {
    const { byId } = await resolve({ bridgeOnline: true }, { model: NO_MODEL });
    expect(byId.ask_ai!.status).toBe("ready");
    expect(byId.writer!.status).toBe("unavailable");
  });

  it("web research is off without a TinyFish key or platform search, and says where to add one", async () => {
    const { byId } = await resolve({});
    expect(byId.ask_ai!.status).toBe("ready");
    expect(byId.web_research!.status).toBe("unavailable");
    expect(byId.web_research!.reason).toBe("missing_key:tinyfish");
    expect(byId.web_research!.sentence).toBe(
      "Web research is off — no TinyFish key for this team. Add one in Team → AI keys.",
    );
    expect(byId.web_research!.setupHref).toContain("/team/ai-keys");
  });

  it("web research is ready with the team's TinyFish key, or with a platform search provider", async () => {
    expect((await resolve({ tinyfish: { lastError: null, lastErrorAt: null } })).byId.web_research!.status).toBe("ready");
    expect((await resolve({}, { env: { BRAVE_SEARCH_API_KEY: "x" } })).byId.web_research!.status).toBe("ready");
  });

  it("a TinyFish key that was rejected, or just rate-limited, is not reported ready", async () => {
    const rejected = await resolve({ tinyfish: { lastError: "invalid_key", lastErrorAt: "2026-09-22T11:00:00Z" } });
    expect(rejected.byId.web_research!.reason).toBe("provider_unavailable");
    const limited = await resolve({ tinyfish: { lastError: "rate_limited", lastErrorAt: "2026-09-22T11:30:00Z" } });
    expect(limited.byId.web_research!.reason).toBe("rate_limited");
    const stale = await resolve({ tinyfish: { lastError: "rate_limited", lastErrorAt: "2026-09-21T11:30:00Z" } });
    expect(stale.byId.web_research!.status).toBe("ready");
  });

  it("the CAD agent needs this member's Onshape link (with OAuth on the deployment) or a Fusion relay", async () => {
    expect((await resolve({})).byId.cad_agent!.reason).toBe("missing_key:onshape");
    const env = { ONSHAPE_OAUTH_CLIENT_ID: "id", ONSHAPE_OAUTH_CLIENT_SECRET: "secret" };
    expect((await resolve({ onshape: { ref: "acct", status: "connected" } }, { env })).byId.cad_agent!.status).toBe("ready");
    expect(
      (await resolve({ fusionRelay: { machineName: "Pit laptop", lastSeenAt: null } })).byId.cad_agent!.status,
    ).toBe("ready");
  });

  it("the code assistant needs GitHub; a refused GitHub credential is not 'connected'", async () => {
    expect((await resolve({})).byId.code_assistant!.reason).toBe("missing_key:github");
    expect((await resolve({ github: { login: "bot", repo: "t/r", status: "connected" } })).byId.code_assistant!.status).toBe("ready");
    expect((await resolve({ github: { login: "bot", repo: "t/r", status: "error" } })).byId.code_assistant!.reason).toBe(
      "provider_unavailable",
    );
  });

  it("the team kill switch pauses every model-backed agent", async () => {
    const { byId } = await resolve({ billing: { ...PROVISIONED_BILLING, killSwitch: true } });
    expect(byId.ask_ai!.reason).toBe("usage_cap");
    expect(byId.writer!.reason).toBe("usage_cap");
  });

  it("an exhausted hosted allowance is a usage cap only when the hosted key is what would answer", async () => {
    const billing = { ...PROVISIONED_BILLING, tier: "team", creditCapUsd: "10" };
    const hosted: ModelProbe = { ok: true, source: "hosted", provider: "anthropic", model: "claude" };
    const client = mockClient({ billing });
    client.query.mockImplementation(async (sql: string) => {
      if (/FROM ai_usage_events/.test(sql)) return { rows: [{ feature: "chat", calls: "3", cost: "10", tokens: "100" }], rowCount: 1 };
      if (/FROM org_billing/.test(sql)) return { rows: [billing], rowCount: 1 };
      if (/FROM memberships WHERE org_id/.test(sql)) return { rows: [{ role: "scout" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const agents = await resolveAiCapabilities(client as never, { orgId: ORG, userId: USER }, { probeModel: async () => hosted, env: {} });
    expect(agents.find((a) => a.id === "ask_ai")!.reason).toBe("usage_cap");
  });

  it("no billing account means AI is not provisioned for the team yet", async () => {
    const { byId } = await resolve({ billing: null });
    expect(byId.ask_ai!.reason).toBe("missing_context:billing_account");
  });

  it("member hub restrictions and the team's feature allowlist are permission refusals", async () => {
    const hub = await resolve({ hubAccess: [{ hubId: "ai", allowedTabIds: ["writer"] }] });
    expect(hub.byId.ask_ai!.reason).toBe("insufficient_permission");
    expect(hub.byId.writer!.status).toBe("ready");
    const policy = await resolve({ policy: { feature_allowlist_enabled: true, allowed_features: ["chat"] } });
    expect(policy.byId.writer!.reason).toBe("insufficient_permission");
    expect(policy.byId.ask_ai!.status).toBe("ready");
    const tools = await resolve({
      tinyfish: { lastError: null, lastErrorAt: null },
      policy: { tool_allowlist_enabled: true, allowed_tools: ["scouting.team"] },
    });
    expect(tools.byId.web_research!.reason).toBe("insufficient_permission");
  });

  it("refuses a caller who is not a member of the team", async () => {
    await expect(resolve({ role: null })).rejects.toThrow(/access denied/i);
  });

  it("never reports an agent ready while one of its requirements is missing", async () => {
    const missing = await resolve({}, { model: NO_MODEL });
    for (const agent of missing.agents) {
      const def = AI_AGENTS.find((a) => a.id === agent.id)!;
      if (def.requires.length) expect(agent.status).toBe("unavailable");
    }
  });
});

describe("probeChatModel", () => {
  it("always rolls its savepoint back, so a status check cannot write", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    };
    await probeChatModel(client as never, { orgId: ORG, userId: USER });
    expect(calls[0]).toMatch(/^SAVEPOINT ai_capabilities_model_probe/);
    expect(calls).toContain("ROLLBACK TO SAVEPOINT ai_capabilities_model_probe");
  });
});
