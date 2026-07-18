import { randomUUID } from "node:crypto";
import {
  AIOrchestrator,
  ChatProviderResolutionError,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapter,
  type ChatAdapter,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  GRANT_AI_MODEL,
  GRANT_USAGE_TAG,
  buildGrantAssistBundle,
  evidenceSnippet,
  loadGrantOrgEvidence,
  parseGrantAssistResponse,
} from "../../../../lib/grant-assist";
import {
  coerceAchievementList,
  preferAchievements,
  preferMission,
  preferRegion,
} from "../../../../lib/team-background";
import type { GrantFocus, WriterProfile, WriterTone } from "../../../../lib/writer/types";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

const GRANT_FOCI: GrantFocus[] = ["general", "impact", "technical", "sustainability", "inclusion"];

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) => failMeteredAi(error, "Grant assist request failed");

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : new Date().getFullYear();
}

function localGrantAdapter(localText: string): ChatAdapter {
  return {
    provider: "local",
    model: GRANT_AI_MODEL,
    complete: async () => ({
      text: localText,
      promptTokens: Math.ceil(localText.length / 4),
      completionTokens: Math.ceil(localText.length / 4),
      costUsd: 0,
    }),
  };
}

async function loadWriterProfile(
  client: Parameters<typeof loadGrantOrgEvidence>[0],
  input: { orgId: string; seasonYear: number; orgName: string; teamNumber: number | null },
): Promise<WriterProfile> {
  const [row, orgRow, background] = await Promise.all([
    client.query<{
      teamName: string | null;
      teamNumber: number | null;
      region: string | null;
      mission: string | null;
      achievements: unknown;
      fundingNeed: string | null;
      fundingAskUsd: string | number | null;
      tone: WriterTone | null;
    }>(
      `SELECT team_name AS "teamName", team_number AS "teamNumber", region, mission, achievements,
              funding_need AS "fundingNeed", funding_ask_usd AS "fundingAskUsd", tone
       FROM writer_profile WHERE org_id = $1 AND season_year = $2`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ city: string | null; stateProv: string | null; description: string | null }>(
      `SELECT city, state_prov AS "stateProv", description FROM organizations WHERE id = $1::uuid`,
      [input.orgId],
    ),
    client.query<{ mission: string | null; achievements: unknown }>(
      `SELECT mission, achievements FROM team_background_profile WHERE org_id = $1::uuid`,
      [input.orgId],
    ),
  ]);
  const profile = row.rows[0];
  const org = orgRow.rows[0];
  const bg = background.rows[0];
  const writerAchievements = Array.isArray(profile?.achievements)
    ? profile!.achievements.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const ask = profile?.fundingAskUsd == null || profile.fundingAskUsd === "" ? null : Number(profile.fundingAskUsd);
  return {
    teamName:
      profile?.teamName ?? input.orgName ?? (input.teamNumber ? `Team ${input.teamNumber}` : "Our team"),
    teamNumber: profile?.teamNumber ?? input.teamNumber,
    region: preferRegion(profile?.region, org?.city, org?.stateProv),
    mission: preferMission(bg?.mission, org?.description, profile?.mission),
    achievements: preferAchievements(coerceAchievementList(bg?.achievements), writerAchievements),
    fundingNeed: profile?.fundingNeed ?? null,
    fundingAskUsd: ask != null && Number.isFinite(ask) ? ask : null,
    tone: profile?.tone ?? "warm",
  };
}

/** GET — pull THIS org's impact metrics, community hours, and season goals. */
export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const seasonYear = seasonFrom(url.searchParams.get("seasonYear"));

    const payload = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        current.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");

      const evidence = await loadGrantOrgEvidence(client, { orgId, seasonYear });
      if (!evidence || evidence.orgId !== orgId) throw new Error("Organization scope mismatch");

      return {
        orgId: evidence.orgId,
        orgName: evidence.orgName,
        teamNumber: evidence.teamNumber,
        seasonYear: evidence.seasonYear,
        impact: evidence.impact,
        communityHours: evidence.communityHours,
        seasonGoals: evidence.seasonGoals,
        awards: evidence.awards,
        snippet: evidenceSnippet(evidence),
        awardsWorkbenchHref: `/team/awards?orgId=${encodeURIComponent(orgId)}`,
        impactHref: `/impact?orgId=${encodeURIComponent(orgId)}`,
        goalsHref: `/goals?orgId=${encodeURIComponent(orgId)}`,
      };
    });

    return Response.json(payload);
  } catch (error) {
    return fail(error);
  }
}

/** POST — metered AI (or local template) grant draft using THIS org's evidence only. */
export async function POST(request: Request) {
  try {
    const current = await session();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON body");
    }

    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    if (!orgId) throw new Error("orgId is required");
    const seasonYear = seasonFrom(body.seasonYear);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
    const charLimitRaw = body.charLimit == null || body.charLimit === "" ? null : Number(body.charLimit);
    const charLimit =
      charLimitRaw != null && Number.isFinite(charLimitRaw) && charLimitRaw > 0 ? Math.round(charLimitRaw) : null;
    const focus = oneOf<GrantFocus>(GRANT_FOCI, body.focus) ?? "impact";
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const saveToItem = body.saveToItem === true && Boolean(itemId);

    const result = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query<{ orgName: string; teamNumber: number | null }>(
        `SELECT o.name AS "orgName", o.team_number AS "teamNumber"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id = $1 AND m.user_id = $2`,
        [orgId, current.user.id],
      );
      if (!member.rowCount) throw new Error("Organization access denied");

      const evidence = await loadGrantOrgEvidence(client, { orgId, seasonYear });
      if (!evidence || evidence.orgId !== orgId) throw new Error("Organization scope mismatch");

      const profile = await loadWriterProfile(client, {
        orgId,
        seasonYear,
        orgName: member.rows[0]!.orgName,
        teamNumber: member.rows[0]!.teamNumber,
      });

      const bundle = buildGrantAssistBundle({
        profile,
        evidence,
        prompt,
        charLimit,
        focus,
      });

      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      let adapter: ChatAdapter;
      try {
        adapter = await resolveOrgChatAdapter(client, { orgId, promptCachingEnabled });
      } catch (error) {
        if (!(error instanceof ChatProviderResolutionError)) throw error;
        adapter = localGrantAdapter(bundle.localBody);
      }

      const run = await new AIOrchestrator(client).run({
        orgId,
        userId: current.user.id,
        requestId: randomUUID(),
        capability: "writer",
        privacyScope: "team",
        message: bundle.message,
        adapter,
        contextSources: bundle.sources,
        usesOrgData: true,
        autoTools: false,
        promptCachingEnabled,
      });

      const usedLocal = run.provider === "local" && run.model === GRANT_AI_MODEL;
      const parsed = parseGrantAssistResponse(run.text, bundle.localBody);
      const draftBody = usedLocal ? bundle.localBody : parsed.body;
      const source = usedLocal ? "template" : parsed.source;

      if (saveToItem) {
        const admin = await client.query(
          `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 AND role IN ('owner','admin')`,
          [orgId, current.user.id],
        );
        if (!admin.rowCount) throw new Error("Organization administrator access required");
        const updated = await client.query(
          `UPDATE grant_application_items
           SET content = $1, updated_at = now()
           WHERE id = $2 AND org_id = $3
           RETURNING id`,
          [draftBody, itemId, orgId],
        );
        if (!updated.rowCount) throw new Error("Grant item not found");
      }

      return {
        body: draftBody,
        source,
        provenance: bundle.provenance,
        evidence: {
          impact: evidence.impact,
          communityHours: evidence.communityHours,
          seasonGoals: evidence.seasonGoals,
          awards: evidence.awards,
        },
        runId: run.runId,
        provider: run.provider,
        model: run.model,
        usageTag: GRANT_USAGE_TAG,
        orgScoped: true,
        awardsWorkbenchHref: `/team/awards?orgId=${encodeURIComponent(orgId)}`,
      };
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
