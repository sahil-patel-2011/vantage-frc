/**
 * Every user-facing AI agent in Vantage, what it needs, and — per team and per member —
 * whether it can run right now.
 *
 * Before this file the only way to learn that web research had no key, or that the CAD agent
 * had no Onshape link, was to ask it something and read the error (`metered-ai-fail.ts` turns a
 * failure into setup steps AFTER the call). This registry answers first, from the same
 * configuration the call paths read:
 *
 *   chat model     → `resolveOrgChatAdapterWithProvenance` itself, with a no-op decrypt, inside
 *                    a savepoint that is always rolled back (so a status check never writes)
 *   TinyFish key   → `org_tool_keys` (0667) presence + last recorded outcome, or a platform
 *                    search provider (`resolveWebSearchProvider`)
 *   GitHub/Onshape → `loadConnectorProofs` — the connectors page's proof-of-link reader
 *   Fusion         → the same proofs (paired relay device)
 *   team policy    → `loadOrgAiPolicy` feature/tool allowlists
 *   spending       → `readOrgAllowance` (the window `meteredAI` enforces) + kill switches
 *   role / hub     → `memberships.role`, `listMemberHubAccess`
 *
 * The rule the UI relies on: an agent is never "ready" while a requirement it cannot run
 * without is missing.
 */
import type { PoolClient } from "@neondatabase/serverless";
import {
  BRIDGE_ONLINE_WINDOW_MS,
  ChatProviderResolutionError,
  CROSS_FEATURE_TOOL_GRAPH,
  isAiWriteTool,
  resolveOrgChatAdapterWithProvenance,
  resolveWebSearchProvider,
  type ResolvedModelSource,
} from "@vantage/agent";
import {
  isFeatureAllowed,
  isToolAllowed,
  loadOrgAiPolicy,
  mapOrgAiPolicyRow,
  readOrgAllowance,
  type OrgAiPolicy,
} from "@vantage/billing";
import { canAccessHubTab, listMemberHubAccess, type MemberHubAccessRow, type OrgRole } from "@vantage/core";
import { withSavepoint } from "@vantage/db";
import { readHostedOnshapeEnvFlags } from "../cad/hosted-auth";
import { loadConnectorProofs, type ConnectorProofs } from "../connectors/load-connector-status";

export type AiAgentId =
  | "ask_ai"
  | "web_research"
  | "autonomous_agent"
  | "cad_agent"
  | "cad_brief"
  | "writer"
  | "code_assistant"
  | "intel_research";

/** Something an agent cannot run without. */
export type AiRequirement =
  | "chat_model"
  | "web_search"
  | "cad_connection"
  | "github"
  | "research_search";

export type AiAgentDefinition = {
  id: AiAgentId;
  name: string;
  purpose: string;
  /** Where the agent lives in the product. */
  href: string;
  /** `meteredAI` feature — also the key the team's AI policy feature allowlist uses. */
  feature: string;
  requires: readonly AiRequirement[];
  /** Registry tool ids the agent may call (packages/agent tools.ts, via CROSS_FEATURE_TOOL_GRAPH). */
  tools: readonly string[];
  /** Org roles that may use it. */
  roles: readonly OrgRole[];
  /** AI hub tab that member hub-access restrictions gate, when there is one. */
  hubTab: string | null;
  /** True when it can change team data. Registry write tools only PROPOSE (action-proposals.ts). */
  writes: boolean;
  writeNote: string | null;
};

const ALL_MEMBERS: readonly OrgRole[] = ["owner", "admin", "scout", "viewer"];

function writesVia(tools: readonly string[]): boolean {
  return tools.some((tool) => isAiWriteTool(tool));
}

/**
 * Only agents that exist, with the routes that serve them. Deterministic "copilots" that never
 * call a model (e.g. Match Copilot's rule fusion) are not agents and are not listed.
 */
export const AI_AGENTS: readonly AiAgentDefinition[] = [
  {
    id: "ask_ai",
    name: "Ask AI",
    purpose: "Answers questions about teams, matches, scouting, CAD, parts and the calendar from this team's own records.",
    href: "/chat",
    feature: "chat",
    requires: ["chat_model"],
    tools: CROSS_FEATURE_TOOL_GRAPH.chat,
    roles: ALL_MEMBERS,
    hubTab: "chat",
    writes: writesVia(CROSS_FEATURE_TOOL_GRAPH.chat),
    writeNote: "Can propose a purchase request or a CAD brief; nothing is created until you confirm it.",
  },
  {
    id: "web_research",
    name: "Web research",
    purpose: "Lets Ask AI and the agent search the public web and read pages, with sources.",
    href: "/chat",
    feature: "chat",
    requires: ["chat_model", "web_search"],
    tools: ["web.search", "web.fetch"],
    roles: ALL_MEMBERS,
    hubTab: "chat",
    writes: false,
    writeNote: null,
  },
  {
    id: "autonomous_agent",
    name: "Autonomous agent",
    purpose: "Works through a multi-step goal on its own — search, read, and check team data — and reports back.",
    href: "/ai?tab=agent",
    feature: "agent",
    requires: ["chat_model"],
    tools: CROSS_FEATURE_TOOL_GRAPH.agent,
    roles: ALL_MEMBERS,
    hubTab: "agent",
    writes: writesVia(CROSS_FEATURE_TOOL_GRAPH.agent),
    writeNote: null,
  },
  {
    id: "cad_agent",
    name: "CAD agent",
    purpose: "Reads and edits an Onshape Part Studio (or drives Fusion 360 through the team's relay) from a plan you approve.",
    href: "/cad",
    feature: "cad",
    requires: ["chat_model", "cad_connection"],
    tools: CROSS_FEATURE_TOOL_GRAPH.cad,
    roles: ALL_MEMBERS,
    hubTab: null,
    writes: true,
    writeNote: "Writes to your CAD document only after you approve its plan.",
  },
  {
    id: "cad_brief",
    name: "CAD engineering brief",
    purpose: "Turns a design request into a brief grounded in strategy, rules, FMEA risks and inventory.",
    href: "/cad",
    feature: "cad",
    requires: ["chat_model"],
    tools: CROSS_FEATURE_TOOL_GRAPH.cad_brief,
    roles: ALL_MEMBERS,
    hubTab: null,
    writes: true,
    writeNote: "Saves a CAD job for the team when you create a brief.",
  },
  {
    id: "writer",
    name: "Writer",
    purpose: "Drafts and edits award essays, outreach and sponsor copy.",
    href: "/ai?tab=writer",
    feature: "writer",
    requires: ["chat_model"],
    tools: [],
    roles: ALL_MEMBERS,
    hubTab: "writer",
    writes: false,
    writeNote: null,
  },
  {
    id: "code_assistant",
    name: "Code assistant & Bugbot",
    purpose: "Reviews robot code from the team's GitHub repository and explains what to fix. It never pushes.",
    href: "/ai?tab=code",
    feature: "coding",
    requires: ["chat_model", "github"],
    tools: [],
    roles: ALL_MEMBERS,
    hubTab: "code",
    writes: false,
    writeNote: null,
  },
  {
    id: "intel_research",
    name: "Team research",
    purpose: "Researches another FRC team on demand and files source-cited findings in Intel.",
    href: "/intel",
    feature: "research",
    requires: ["research_search"],
    tools: ["research.findings"],
    roles: ALL_MEMBERS,
    hubTab: null,
    writes: true,
    writeNote: "Saves findings to the team's Intel page.",
  },
];

export type AiUnavailableReason =
  | "no_model_provider"
  | `missing_key:${string}`
  | "provider_unavailable"
  | "insufficient_permission"
  | `missing_context:${string}`
  | "rate_limited"
  | "usage_cap";

export type AiAgentStatus = {
  id: AiAgentId;
  name: string;
  purpose: string;
  href: string;
  status: "ready" | "unavailable";
  reason: AiUnavailableReason | null;
  /** One plain sentence. */
  sentence: string;
  setupHref: string | null;
  setupLabel: string | null;
  tools: readonly string[];
  writes: boolean;
  writeNote: string | null;
};

export type ModelProbe =
  | { ok: true; source: ResolvedModelSource | "subscription-bridge"; provider: string; model: string }
  | { ok: false; reason: "no_model_provider" | "provider_unavailable"; message: string };

export type ToolKeyProbe = {
  configured: boolean;
  lastError: "invalid_key" | "rate_limited" | "unavailable" | "bad_request" | null;
  lastErrorAt: string | null;
};

/** Everything the evaluation needs, gathered once per request. Exported for tests. */
export type AiCapabilityFacts = {
  role: OrgRole;
  hubAccess: MemberHubAccessRow[];
  policy: OrgAiPolicy;
  model: ModelProbe;
  tinyfish: ToolKeyProbe;
  platformSearch: boolean;
  researchSearch: boolean;
  proofs: ConnectorProofs;
  /** A paired Claude Code bridge that prefers to answer and has checked in recently. */
  bridgeOnline: boolean;
  onshapeOAuthConfigured: boolean;
  billing: {
    configured: boolean;
    killSwitch: boolean;
    platformKillSwitch: boolean;
    hostedAllowanceExhausted: boolean;
  };
  now: number;
};

export type ResolveAiCapabilitiesDeps = {
  env?: Record<string, string | undefined>;
  /** Injected in tests; defaults to a read-only probe of the real resolver. */
  probeModel?: (client: PoolClient, input: { orgId: string; userId: string }) => Promise<ModelProbe>;
  now?: number;
};

const SETUP = {
  keys: { href: "/team/ai-keys", label: "Set up AI keys" },
  webKey: { href: "/team/ai-keys#ai-keys-web-title", label: "Add a TinyFish key" },
  github: { href: "/connectors/github", label: "Connect GitHub" },
  cad: { href: "/cad/connections", label: "Connect CAD" },
  budgets: { href: "/ai?tab=budgets", label: "Review AI limits" },
  governance: { href: "/ai?tab=governance", label: "Open AI governance" },
  connectors: { href: "/connectors", label: "See connectors" },
} as const;

const TINYFISH_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

/**
 * Probe the real chat-model chain without spending, decrypting, or writing.
 *
 * `decrypt` is stubbed so no KMS call happens (a stored key is "present"; whether its provider
 * accepts it is learned on the first real call). The whole probe runs inside a savepoint that is
 * rolled back, so anything the resolver would record — e.g. the sponsored-promo-expired notice —
 * never persists from a status check.
 */
export async function probeChatModel(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<ModelProbe> {
  const savepoint = "ai_capabilities_model_probe";
  let inTransaction = true;
  try {
    await client.query(`SAVEPOINT ${savepoint}`);
  } catch {
    inTransaction = false;
  }
  try {
    const resolved = await resolveOrgChatAdapterWithProvenance(client, {
      orgId: input.orgId,
      userId: input.userId,
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "capability-probe",
    });
    return {
      ok: true,
      source: resolved.provenance.source,
      provider: resolved.provenance.provider,
      model: resolved.provenance.modelId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No AI model is available.";
    // The resolver's own refusals: a relay-only or unsupported provider is configured but
    // unusable here; every other refusal means there is simply no model for this team.
    const unusable = /local desktop relay|not a supported/i.test(message);
    const noModel = error instanceof ChatProviderResolutionError && !unusable;
    return { ok: false, reason: noModel ? "no_model_provider" : "provider_unavailable", message };
  } finally {
    if (inTransaction) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        // Connection unusable; withRls rolls the request back.
      }
    }
  }
}

async function loadRole(client: PoolClient, orgId: string, userId: string): Promise<OrgRole | null> {
  const result = await client.query<{ role: OrgRole }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  return result.rows[0]?.role ?? null;
}

async function loadTinyfishProbe(client: PoolClient, orgId: string): Promise<ToolKeyProbe> {
  const rows = await withSavepoint(
    client,
    async () =>
      (
        await client.query<{ lastError: ToolKeyProbe["lastError"]; lastErrorAt: string | null }>(
          `SELECT last_error AS "lastError", last_error_at::text AS "lastErrorAt"
             FROM org_tool_keys
            WHERE org_id = $1::uuid AND tool = 'tinyfish'
            LIMIT 1`,
          [orgId],
        )
      ).rows,
    [] as Array<{ lastError: ToolKeyProbe["lastError"]; lastErrorAt: string | null }>,
  );
  const row = rows[0];
  return row
    ? { configured: true, lastError: row.lastError ?? null, lastErrorAt: row.lastErrorAt ?? null }
    : { configured: false, lastError: null, lastErrorAt: null };
}

async function loadBillingFacts(
  client: PoolClient,
  orgId: string,
  model: ModelProbe,
): Promise<AiCapabilityFacts["billing"]> {
  const allowance = await withSavepoint(client, () => readOrgAllowance(client, orgId), null);
  const usage = await withSavepoint(
    client,
    async () =>
      (
        await client.query<{ paygEnabled: boolean | null; killSwitch: boolean | null }>(
          `SELECT payg_enabled AS "paygEnabled", kill_switch AS "killSwitch"
             FROM org_usage_policies WHERE org_id = $1::uuid`,
          [orgId],
        )
      ).rows[0] ?? null,
    null,
  );
  const hosted = model.ok && model.source === "hosted";
  return {
    // Unknown (unreadable) is not "missing": only a definite empty read says no billing row.
    configured: allowance ? allowance.configured : true,
    killSwitch: Boolean(allowance?.killSwitch),
    platformKillSwitch: hosted && usage?.killSwitch === true,
    hostedAllowanceExhausted:
      hosted &&
      Boolean(allowance?.configured) &&
      (allowance?.includedAllowanceUsd ?? 0) > 0 &&
      (allowance?.remainingUsd ?? 1) <= 0 &&
      usage?.paygEnabled !== true,
  };
}

/** Gather every fact once. Throws when the user is not a member of `orgId`. */
export async function loadAiCapabilityFacts(
  client: PoolClient,
  input: { orgId: string; userId: string },
  deps: ResolveAiCapabilitiesDeps = {},
): Promise<AiCapabilityFacts> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const role = await loadRole(client, input.orgId, input.userId);
  if (!role) throw new Error("Organization access denied");

  const hubAccess = await withSavepoint(client, () => listMemberHubAccess(client, input.orgId, input.userId), []);
  const policy = await withSavepoint(client, () => loadOrgAiPolicy(client, input.orgId), null);
  const model = await (deps.probeModel ?? probeChatModel)(client, input);
  const tinyfish = await loadTinyfishProbe(client, input.orgId);
  const proofs = await loadConnectorProofs(client, { userId: input.userId, orgId: input.orgId });
  const billing = await loadBillingFacts(client, input.orgId, model);
  // Same device predicate the resolver's bridge path uses (resolve-chat-adapter.ts).
  const bridge = await withSavepoint(
    client,
    async () =>
      (
        await client.query(
          `SELECT 1 FROM ai_bridge_devices
            WHERE org_id = $1::uuid AND revoked_at IS NULL AND prefer_when_online
              AND last_heartbeat_at > now() - ($2::int * interval '1 millisecond')
            LIMIT 1`,
          [input.orgId, BRIDGE_ONLINE_WINDOW_MS],
        )
      ).rowCount ?? 0,
    0,
  );

  return {
    role,
    hubAccess,
    // An unreadable policy row is treated as the default (no allowlists), which is what
    // meteredAI also does when the table is absent.
    policy: policy ?? mapOrgAiPolicyRow(undefined),
    model,
    tinyfish,
    platformSearch: resolveWebSearchProvider(env).kind !== null,
    researchSearch: Boolean(env.RESEARCH_SEARCH_ENDPOINT?.trim() && env.RESEARCH_SEARCH_API_KEY?.trim()),
    proofs,
    bridgeOnline: bridge > 0,
    onshapeOAuthConfigured: readHostedOnshapeEnvFlags(env as NodeJS.ProcessEnv).oauthConfigured,
    billing,
    now: deps.now ?? Date.now(),
  };
}

type Verdict = { reason: AiUnavailableReason; sentence: string; setup: { href: string; label: string } | null };

function checkModel(agent: AiAgentDefinition, facts: AiCapabilityFacts): Verdict | null {
  if (!facts.billing.configured) {
    return {
      reason: "missing_context:billing_account",
      sentence: `${agent.name} is off — AI isn't provisioned for this team yet. Ask your Vantage admin to finish setting up the team.`,
      setup: null,
    };
  }
  if (facts.billing.killSwitch) {
    return {
      reason: "usage_cap",
      sentence: `${agent.name} is paused — an owner turned on this team's AI kill switch. Turn it off in AI → Limits.`,
      setup: SETUP.budgets,
    };
  }
  if (!facts.model.ok) {
    // The Claude Code bridge answers chat-class features without any key.
    if ((agent.feature === "chat" || agent.feature === "agent") && facts.bridgeOnline) return null;
    if (facts.model.reason === "no_model_provider") {
      return {
        reason: "no_model_provider",
        sentence: `${agent.name} is off — this team has no AI model set up. Add a key in Team → AI keys.`,
        setup: SETUP.keys,
      };
    }
    return {
      reason: "provider_unavailable",
      sentence: `${agent.name} is off — the team's AI provider can't be reached from Vantage (${facts.model.message.split(".")[0]}). Check Team → AI keys.`,
      setup: SETUP.keys,
    };
  }
  if (facts.billing.platformKillSwitch || facts.billing.hostedAllowanceExhausted) {
    return {
      reason: "usage_cap",
      sentence: `${agent.name} is off — this team has used its hosted AI allowance for this period. Add your own key or raise the limit in AI → Limits.`,
      setup: SETUP.budgets,
    };
  }
  return null;
}

function checkRequirement(requirement: AiRequirement, agent: AiAgentDefinition, facts: AiCapabilityFacts): Verdict | null {
  switch (requirement) {
    case "chat_model":
      return checkModel(agent, facts);
    case "web_search": {
      if (!isToolAllowed(facts.policy, "web.search")) {
        return {
          reason: "insufficient_permission",
          sentence: `${agent.name} is off — your team's AI policy doesn't allow web search. An owner can change it in AI governance.`,
          setup: SETUP.governance,
        };
      }
      if (facts.tinyfish.configured) {
        if (facts.tinyfish.lastError === "invalid_key") {
          return {
            reason: "provider_unavailable",
            sentence: `${agent.name} is off — TinyFish rejected this team's key. Replace it in Team → AI keys.`,
            setup: SETUP.webKey,
          };
        }
        const limitedAt = facts.tinyfish.lastErrorAt ? Date.parse(facts.tinyfish.lastErrorAt) : NaN;
        if (
          facts.tinyfish.lastError === "rate_limited" &&
          Number.isFinite(limitedAt) &&
          facts.now - limitedAt < TINYFISH_RATE_LIMIT_WINDOW_MS
        ) {
          return {
            reason: "rate_limited",
            sentence: `${agent.name} is paused — the team's TinyFish key hit its rate limit in the last hour. Try again later.`,
            setup: SETUP.webKey,
          };
        }
        return null;
      }
      if (facts.platformSearch) return null;
      return {
        reason: "missing_key:tinyfish",
        sentence: `${agent.name} is off — no TinyFish key for this team. Add one in Team → AI keys.`,
        setup: SETUP.webKey,
      };
    }
    case "cad_connection": {
      const onshape = facts.proofs.onshape?.linked === true;
      const fusion = facts.proofs["fusion-relay"]?.linked === true;
      if (onshape && facts.onshapeOAuthConfigured) return null;
      if (fusion) return null;
      if (onshape && !facts.onshapeOAuthConfigured) {
        return {
          reason: "provider_unavailable",
          sentence: `${agent.name} is off — Onshape sign-in isn't configured on this Vantage deployment. Ask your Vantage admin.`,
          setup: SETUP.connectors,
        };
      }
      return {
        reason: "missing_key:onshape",
        sentence: `${agent.name} is off — you haven't connected Onshape (or paired a Fusion 360 relay). Connect one in CAD → Connections.`,
        setup: SETUP.cad,
      };
    }
    case "github": {
      const proof = facts.proofs.github;
      if (proof?.linked && proof.refreshable === false && proof.expiresAt === 1) {
        return {
          reason: "provider_unavailable",
          sentence: `${agent.name} is off — GitHub refused the team's stored connection. Reconnect it in Team admin.`,
          setup: SETUP.github,
        };
      }
      if (proof?.linked) return null;
      return {
        reason: "missing_key:github",
        sentence: `${agent.name} is off — GitHub isn't connected for this team. Connect it in Connectors.`,
        setup: SETUP.github,
      };
    }
    case "research_search":
      return facts.researchSearch
        ? null
        : {
            reason: "provider_unavailable",
            sentence: `${agent.name} isn't available on Vantage yet. Everything else works without it.`,
            setup: null,
          };
    default: {
      const _never: never = requirement;
      return _never;
    }
  }
}

function checkPermission(agent: AiAgentDefinition, facts: AiCapabilityFacts): Verdict | null {
  if (!agent.roles.includes(facts.role)) {
    return {
      reason: "insufficient_permission",
      sentence: `${agent.name} isn't available to your role on this team.`,
      setup: null,
    };
  }
  if (agent.hubTab && !canAccessHubTab(facts.hubAccess, "ai", agent.hubTab)) {
    return {
      reason: "insufficient_permission",
      sentence: `${agent.name} isn't turned on for your account — ask a team owner or admin for access.`,
      setup: null,
    };
  }
  if (!isFeatureAllowed(facts.policy, agent.feature)) {
    return {
      reason: "insufficient_permission",
      sentence: `${agent.name} is off — your team's AI policy doesn't allow it. An owner can change it in AI governance.`,
      setup: SETUP.governance,
    };
  }
  return null;
}

function readySentence(agent: AiAgentDefinition, facts: AiCapabilityFacts): string {
  if (agent.requires.includes("chat_model") && facts.model.ok && facts.model.source === "public-swarm") {
    return `${agent.name} is ready on the free volunteer AI swarm — answers can be slow, and your own key makes it faster.`;
  }
  if (agent.id === "web_research" && !facts.tinyfish.configured && facts.platformSearch) {
    return `${agent.name} is ready using Vantage's search; add a TinyFish key to let it read more than FRC docs.`;
  }
  return `${agent.name} is ready.`;
}

/** Pure: facts → one status per agent. */
export function evaluateAiCapabilities(
  facts: AiCapabilityFacts,
  agents: readonly AiAgentDefinition[] = AI_AGENTS,
): AiAgentStatus[] {
  return agents.map((agent) => {
    let verdict: Verdict | null = checkPermission(agent, facts);
    for (const requirement of agent.requires) {
      if (verdict) break;
      verdict = checkRequirement(requirement, agent, facts);
    }
    return {
      id: agent.id,
      name: agent.name,
      purpose: agent.purpose,
      href: agent.href,
      status: verdict ? "unavailable" : "ready",
      reason: verdict?.reason ?? null,
      sentence: verdict?.sentence ?? readySentence(agent, facts),
      setupHref: verdict?.setup?.href ?? null,
      setupLabel: verdict?.setup?.label ?? null,
      tools: agent.tools,
      writes: agent.writes,
      writeNote: agent.writeNote,
    };
  });
}

/** Per-agent status for one member of one team, on that member's RLS client. */
export async function resolveAiCapabilities(
  client: PoolClient,
  input: { orgId: string; userId: string },
  deps: ResolveAiCapabilitiesDeps = {},
): Promise<AiAgentStatus[]> {
  const facts = await loadAiCapabilityFacts(client, input, deps);
  return evaluateAiCapabilities(facts);
}

export function isAiAgentId(value: string): value is AiAgentId {
  return AI_AGENTS.some((agent) => agent.id === value);
}
