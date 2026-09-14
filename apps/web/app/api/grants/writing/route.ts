import { randomUUID } from "node:crypto";
import {
  AIOrchestrator,
  ChatProviderResolutionError,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapter,
  type ChatAdapter,
} from "@vantage/agent";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  GRANT_AI_MODEL,
  buildGrantAssistBundle,
  loadGrantOrgEvidence,
  parseGrantAssistResponse,
} from "../../../../lib/grant-assist";
import {
  composeAndSaveGrantDraft,
  computeGrantWritingView,
  currentSeasonYear,
  deleteGrantWritingDraft,
  parseGrantDraftStatus,
  parseGrantTemplateKey,
  saveGrantWritingDraft,
  setGrantDraftStatus,
  type GrantWritingView,
} from "../../../../lib/grant-writing";
import type { WriterProfile } from "../../../../lib/writer/types";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

export type { GrantWritingView };

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function fieldsFromBody(body: Record<string, unknown>) {
  return {
    need: trimmedOrNull(body.need, 8000) ?? "",
    impact: trimmedOrNull(body.impact, 8000) ?? "",
    budget: trimmedOrNull(body.budget, 8000) ?? "",
    timeline: trimmedOrNull(body.timeline, 8000) ?? "",
  };
}

/**
 * Grant drafting can call a real upstream model. A bridged turn (a paired device with
 * coverage 'everything') holds the request open for the bridge poll budget
 * (BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS, 240s), so this function declares 300s to keep
 * headroom above it; the adapter's own timeout still fires first and returns a
 * classified error instead of the platform killing the function mid-request.
 *
 * 300s is only honored where the hosting plan's Node function cap reaches it. Below
 * that cap set VANTAGE_BRIDGE_MAX_WAIT_MS so the turn falls through to the team's own
 * keys instead of 504-ing — see docs/AI_BRIDGE.md "Function duration".
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonYear = url.searchParams.get("seasonYear")
    ? seasonFrom(url.searchParams.get("seasonYear"))
    : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeGrantWritingView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load grant writing. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies GrantWritingView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");

      switch (action) {
        case "compose": {
          const templateKey = parseGrantTemplateKey(body.templateKey);
          if (!templateKey) throw new Error("Invalid templateKey");
          await composeAndSaveGrantDraft(client, {
            orgId,
            userId,
            seasonYear,
            templateKey,
            funderName: trimmedOrNull(body.funderName, 240),
            askAmountUsd: moneyOrNull(body.askAmountUsd),
            fields: fieldsFromBody(body),
          });
          break;
        }
        case "ai_assist": {
          const templateKey = parseGrantTemplateKey(body.templateKey) ?? "general_narrative";
          const fields = fieldsFromBody(body);
          const evidence = await loadGrantOrgEvidence(client, { orgId, seasonYear });
          if (!evidence || evidence.orgId !== orgId) throw new Error("Organization scope mismatch");

          const profile: WriterProfile = {
            teamName: evidence.orgName,
            teamNumber: evidence.teamNumber,
            region: evidence.location,
            mission: evidence.description,
            achievements: evidence.awards.slice(0, 5).map((a) => a.awardName),
            fundingNeed: fields.need || null,
            fundingAskUsd: moneyOrNull(body.askAmountUsd),
            tone: "professional",
          };
          const prompt = [
            fields.need && `Need: ${fields.need}`,
            fields.impact && `Impact: ${fields.impact}`,
            fields.budget && `Budget: ${fields.budget}`,
            fields.timeline && `Timeline: ${fields.timeline}`,
          ]
            .filter(Boolean)
            .join("\n") || "Compose a grant narrative for this organization.";

          const bundle = buildGrantAssistBundle({
            profile,
            evidence,
            prompt,
            charLimit: null,
            focus: "impact",
          });

          const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
          let adapter: ChatAdapter;
          try {
            adapter = await resolveOrgChatAdapter(client, {
              orgId,
              promptCachingEnabled,
              feature: "grants",
              bridgeTransport: createBridgeTransport(),
            });
          } catch (error) {
            if (!(error instanceof ChatProviderResolutionError)) throw error;
            adapter = {
              provider: "local",
              model: GRANT_AI_MODEL,
              complete: async () => ({
                text: bundle.localBody,
                promptTokens: Math.ceil(bundle.localBody.length / 4),
                completionTokens: Math.ceil(bundle.localBody.length / 4),
                costUsd: 0,
              }),
            };
          }

          const run = await new AIOrchestrator(client).run({
            orgId,
            userId,
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
          const source = usedLocal ? "template" : "ai";

          await saveGrantWritingDraft(client, {
            orgId,
            userId,
            seasonYear,
            templateKey,
            funderName: trimmedOrNull(body.funderName, 240),
            askAmountUsd: moneyOrNull(body.askAmountUsd),
            fields,
            body: draftBody,
            provenance: bundle.provenance,
            source,
          });
          break;
        }
        case "set_status": {
          const draftId = uuidOrNull(body.draftId);
          const status = parseGrantDraftStatus(body.status);
          if (!draftId || !status) throw new Error("draftId and valid status are required");
          await setGrantDraftStatus(client, { orgId, userId, draftId, status });
          break;
        }
        case "delete": {
          const draftId = uuidOrNull(body.draftId);
          if (!draftId) throw new Error("draftId is required");
          await deleteGrantWritingDraft(client, { orgId, draftId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeGrantWritingView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Grant writing request failed");
  }
}
