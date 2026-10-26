/**
 * Ask AI skills on the server: who may use which skill, which one a turn uses, and the registry
 * tools (`skill.<id>`) the chat turn hands the existing agent orchestrator.
 *
 * The chat does not grow a second agent. Skills ride the same `AIToolRegistry` / `AIOrchestrator`
 * path every chat turn already takes: a pinned or keyword-matched skill runs before the model; a
 * provider with native tool calls may also pick any other skill this person can use.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { skillToolName, type SkillToolOutput, type ToolDefinition } from "@vantage/agent";
import { isFeatureAllowed, isToolAllowed, loadOrgAiPolicy, type OrgAiPolicy } from "@vantage/billing";
import { canAccessHub, listMemberHubAccess, type MemberHubAccessRow } from "@vantage/core";
import { withSavepoint } from "@vantage/db";
import {
  AI_SKILLS,
  aiSkillById,
  chooseAiSkillByKeywords,
  roleMeets,
  type AiSkill,
} from "./catalog";
import { runAiSkill, type SkillPageContext } from "./executors";

export type SkillAccessFacts = {
  role: string | null;
  hubAccess: MemberHubAccessRow[];
  policy: OrgAiPolicy | null;
};

export async function loadSkillAccessFacts(client: PoolClient, orgId: string, userId: string): Promise<SkillAccessFacts> {
  const [roleRow, hubAccess, policy] = await Promise.all([
    client.query<{ role: string }>(
      `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
      [orgId, userId],
    ),
    listMemberHubAccess(client, orgId, userId).catch(() => [] as MemberHubAccessRow[]),
    loadOrgAiPolicy(client, orgId).catch(() => null),
  ]);
  return { role: roleRow.rows[0]?.role ?? null, hubAccess, policy };
}

export type SkillAvailability = { id: string; available: boolean; reason: string | null };

/** Can this member use this skill? Plain words when not. */
export function skillAvailability(skill: AiSkill, facts: SkillAccessFacts): SkillAvailability {
  if (!facts.role) return { id: skill.id, available: false, reason: "You're not on this team." };
  if (!roleMeets(facts.role, skill.access.minRole)) {
    return { id: skill.id, available: false, reason: "Ask a team owner or admin for access to this skill." };
  }
  if (skill.access.hub && !canAccessHub(facts.hubAccess, skill.access.hub)) {
    return { id: skill.id, available: false, reason: "This part of the app isn't open to your account. Ask a team owner or admin." };
  }
  if (facts.policy && !isToolAllowed(facts.policy, skillToolName(skill.id))) {
    return { id: skill.id, available: false, reason: "Your team's AI settings leave this skill off." };
  }
  return { id: skill.id, available: true, reason: null };
}

export function skillAvailabilityList(facts: SkillAccessFacts): SkillAvailability[] {
  return AI_SKILLS.map((skill) => skillAvailability(skill, facts));
}

export function availableSkillIds(facts: SkillAccessFacts): Set<string> {
  return new Set(skillAvailabilityList(facts).filter((row) => row.available).map((row) => row.id));
}

export type RoutedSkill = { skill: AiSkill; source: "pinned" | "keyword" };

/**
 * Which skill this turn uses before the model sees it. A skill the person pinned (the chip, or
 * the page they came from) wins; otherwise the keyword router; otherwise none, and a model with
 * native tools may still pick one. An unknown or unavailable pin falls back to choosing.
 */
export function routeSkillForTurn(input: {
  pinned: string | null | undefined;
  message: string;
  allowed: ReadonlySet<string>;
}): { routed: RoutedSkill | null; pinnedRefused: SkillAvailability | null } {
  const pinned = aiSkillById(input.pinned ?? null);
  if (pinned && input.allowed.has(pinned.id)) return { routed: { skill: pinned, source: "pinned" }, pinnedRefused: null };
  const keyword = chooseAiSkillByKeywords(input.message, input.allowed);
  return {
    routed: keyword ? { skill: keyword, source: "keyword" } : null,
    pinnedRefused: pinned ? { id: pinned.id, available: false, reason: "That skill isn't available to you, so I chose one myself." } : null,
  };
}

/**
 * The `meteredAI` feature for a skill turn: the skill id. A team whose AI governance allowlists
 * features by name (before skills existed) and allows "chat" keeps working — the turn meters as
 * "chat" there instead of being refused for a feature its admin never saw.
 */
export function meteredFeatureForSkill(skill: AiSkill | null, policy: OrgAiPolicy | null): string {
  if (!skill) return "chat";
  if (policy && !isFeatureAllowed(policy, skill.id) && isFeatureAllowed(policy, "chat")) return "chat";
  return skill.id;
}

/** Our own fixed rules for the turn (never the person's or a record's words). */
export function skillInstructions(skill: AiSkill): string {
  return [
    skill.guidance,
    "The skill's tool result (status, summary, highlights, data) is the team's own record of this. If its status is empty or setup_required, say what is missing in one sentence and where to add it.",
  ].join(" ");
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Line breaks and tabs become spaces; page context is one line of data.
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The page context a chat request carries. Data only: it reaches the model as tool input. */
export function sanitizeSkillPage(value: unknown): SkillPageContext {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const from = cleanText(row.from, 200);
  const teamKey = cleanText(row.teamKey, 12)?.toLowerCase() ?? null;
  const matchKey = cleanText(row.matchKey, 40)?.toLowerCase() ?? null;
  const sponsorId = cleanText(row.sponsorId, 64);
  return {
    from: from && from.startsWith("/") ? from : null,
    about: cleanText(row.about, 120),
    sponsorId: sponsorId && /^[0-9a-f-]{36}$/i.test(sponsorId) ? sponsorId : null,
    teamKey: teamKey && /^frc\d{1,5}$/.test(teamKey) ? teamKey : null,
    matchKey: matchKey && /^\d{4}[a-z0-9]+_(?:qm|qf|sf|f)\d+(?:m\d+)?$/.test(matchKey) ? matchKey : null,
  };
}

function skillToolDescription(skill: AiSkill): string {
  return `${skill.name} skill: ${skill.purpose} Use it for requests like: ${skill.starters.map((line) => `"${line}"`).join(", ")}. Reads ${skill.reads.join(", ").toLowerCase()}.`;
}

/** Registry tools for every skill this member may use, bound to this request's page context. */
export function buildSkillTools(input: {
  allowed: ReadonlySet<string>;
  request: string;
  page: SkillPageContext;
  now?: Date;
}): ToolDefinition<unknown, unknown>[] {
  return AI_SKILLS.filter((skill) => input.allowed.has(skill.id)).map((skill) => {
    const definition: ToolDefinition<{ request: string; about: string | null }, SkillToolOutput> = {
      name: skillToolName(skill.id),
      description: skillToolDescription(skill),
      inputSchema: {
        type: "object",
        properties: {
          request: { type: "string", description: "What the person asked, in their words." },
          about: { type: "string", description: "A sponsor, team, match or record the request is about, if named." },
        },
        additionalProperties: false,
      },
      parseInput(value) {
        const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        return {
          request: cleanText(row.request, 2_000) ?? input.request,
          about: cleanText(row.about, 120) ?? input.page.about ?? null,
        };
      },
      parseOutput(value) {
        return value as SkillToolOutput;
      },
      async execute(context, parsed) {
        const result = await runAiSkill(skill.id, {
          client: context.client,
          orgId: context.orgId,
          userId: context.userId,
          activeEventKey: context.activeEventKey,
          request: parsed.request,
          page: { ...input.page, about: parsed.about },
          now: input.now ?? new Date(),
        });
        return (
          result ?? {
            kind: "vantage_skill",
            skill: skill.id,
            status: "setup_required",
            classification: "hard_metric",
            summary: `${skill.name} isn't available right now.`,
            highlights: [],
            data: null,
            next: null,
          }
        );
      },
    };
    return definition as unknown as ToolDefinition<unknown, unknown>;
  });
}

/** What the chat shows for a skill's result: the plain part, without the model. */
export type SkillPreview = Pick<SkillToolOutput, "skill" | "status" | "summary" | "highlights" | "next">;

export function skillPreviewOf(output: SkillToolOutput): SkillPreview {
  return { skill: output.skill, status: output.status, summary: output.summary, highlights: output.highlights, next: output.next ?? null };
}

/** Run one skill directly (no model): the preview shown when AI is off or over its limit. */
export async function runSkillPreview(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  skillId: string;
  request: string;
  page: SkillPageContext;
}): Promise<SkillPreview | null> {
  const active = await withSavepoint(
    input.client,
    async () =>
      (
        await input.client.query<{ activeEventKey: string | null }>(
          `SELECT active_event_key AS "activeEventKey" FROM org_active_context WHERE org_id = $1::uuid`,
          [input.orgId],
        )
      ).rows[0]?.activeEventKey ?? null,
    null,
  );
  const output = await runAiSkill(input.skillId, {
    client: input.client,
    orgId: input.orgId,
    userId: input.userId,
    activeEventKey: active,
    request: input.request,
    page: input.page,
    now: new Date(),
  });
  return output ? skillPreviewOf(output) : null;
}
