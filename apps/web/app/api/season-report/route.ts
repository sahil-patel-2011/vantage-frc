import type { RenderOutcome } from "@vantage/agent";
import { randomUUID } from "node:crypto";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildSeasonReportNarrative,
  extractHighlights,
  extractWatchouts,
  SEASON_REPORT_CATEGORIES,
  SEASON_REPORT_SENTIMENTS,
} from "../../../lib/season-report";
import {
  computeSeasonReportView,
  currentSeasonYear,
  deleteEntry,
  deleteSnapshot,
  generateSnapshot,
  loadEntries,
  logEntry,
  type SeasonReportView,
} from "../../../lib/season-report/compute-season-report";
import {
  buildSeasonNarrativePrompt,
  SEASON_REPORT_AI_FEATURE,
} from "../../../lib/season-report/narrative-prompt";
import type { SeasonReportCategory, SeasonReportSentiment } from "../../../lib/season-report/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { SeasonReportView };

/**
 * "expand-narrative" reaches a real upstream model. A bridged turn (a paired device with
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

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSeasonReportView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the season report. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SeasonReportView,
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

  // Optional metered AI path: expand the deterministic retrospective into a
  // cohesive narrative. The computed snapshot always stands on its own; when no
  // adapter resolves this returns setup_required (503) and the client keeps
  // showing the computed text (learning_coach pattern).
  if (action === "expand-narrative") {
    try {
      const expansion = await withRls({ userId, orgId }, async (client) => {
        const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
          orgId,
          userId,
        ]);
        if (!member.rowCount) throw new Error("forbidden");

        const entries = await loadEntries(client, orgId, seasonYear);
        const message = buildSeasonNarrativePrompt({
          seasonYear,
          narrative: buildSeasonReportNarrative(entries),
          highlights: extractHighlights(entries),
          watchouts: extractWatchouts(entries),
          entryCount: entries.length,
        });
        if (!message) throw new Error("Log at least one entry before expanding the narrative");

        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          userId,
          promptCachingEnabled,
          feature: SEASON_REPORT_AI_FEATURE,
          bridgeTransport: createBridgeTransport(),
        });
        const text = await meteredAI({
          client,
          orgId,
          userId,
          feature: SEASON_REPORT_AI_FEATURE,
          requestId: randomUUID(),
          estimatedCostUsd: 0.01,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: 400,
          provider: adapter.provider,
          model: adapter.model,
          metadata: { action: "expand_narrative", seasonYear, entryCount: entries.length },
          invoke: async () => {
            const result = await adapter.complete({ message, context: [], promptCachingEnabled });
            return {
              value: result.text,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              costUsd: result.costUsd,
              model: adapter.model,
              provider: adapter.provider,
              cacheReadInputTokens: result.cacheReadInputTokens,
              cacheWriteInputTokens: result.cacheWriteInputTokens,
              uncachedInputTokens: result.uncachedInputTokens,
            };
          },
        });
        return {
          text,
          generatedAt: new Date().toISOString(),
          provider: adapter.provider,
          model: adapter.model,
        };
      });
      return Response.json(expansion);
    } catch (error) {
      return failMeteredAi(error, "The AI narrative expansion is unavailable right now.");
    }
  }

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      let render: RenderOutcome | undefined;
      switch (action) {
        case "log-entry": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const category = oneOf<SeasonReportCategory>(SEASON_REPORT_CATEGORIES, body.category) ?? "lessons";
          const sentiment = oneOf<SeasonReportSentiment>(SEASON_REPORT_SENTIMENTS, body.sentiment) ?? "neutral";
          await logEntry(client, {
            orgId,
            userId,
            seasonYear,
            category,
            title,
            detail: trimmedOrNull(body.detail, 4000),
            metricLabel: trimmedOrNull(body.metricLabel, 100),
            metricValue: numberOrNull(body.metricValue),
            sentiment,
          });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteEntry(client, { orgId, entryId });
          break;
        }
        case "generate-snapshot": {
          render = (await generateSnapshot(client, { orgId, userId, seasonYear })).render ?? undefined;
          break;
        }
        case "delete-snapshot": {
          const snapshotId = trimmedOrNull(body.snapshotId, 64);
          if (!snapshotId) throw new Error("snapshotId is required");
          await deleteSnapshot(client, { orgId, snapshotId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      const view = await computeSeasonReportView(client, { userId, requestedOrg: orgId, seasonYear });
      return render ? { ...view, render } : view;
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Season report request failed");
  }
}
