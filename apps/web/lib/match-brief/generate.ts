import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { createBridgeTransport } from "../ai-bridge/transport";
import { computeStrategyView } from "../strategy/compute-strategy";
import type { StrategyView } from "../strategy/types";
import { composeLocalMatchBrief } from "./local";
import { parseMatchBrief } from "./parse";
import { buildMatchBriefPrompt } from "./prompt";
import { briefIsStale, loadBriefInputs, loadLatestMatchBrief, saveMatchBrief } from "./store";
import { MATCH_BRIEF_FEATURE, MATCH_BRIEF_KIND, type MatchBrief, type MatchBriefContent } from "./types";

type LiveView = Extract<StrategyView, { status: "live" }>;

export type MatchBriefResult =
  | { status: "ready"; brief: MatchBrief; stale: boolean; generated: boolean }
  | { status: "empty"; matchKey: string | null; message: string }
  | { status: "setup_required"; message: string };

/** Two people opening the match page in the same minute must not both pay for a brief. */
const RECENT_WRITE_MS = 60_000;

function writtenJustNow(brief: MatchBrief | null): boolean {
  return Boolean(brief && Date.now() - new Date(brief.source.generatedAt).getTime() < RECENT_WRITE_MS);
}

/** "2026casj_qm50" → "2026casj"; null for anything that isn't a match key. */
export function eventKeyOfMatch(matchKey: string): string | null {
  const match = matchKey.match(/^(\d{4}[a-z0-9]+)_[a-z]+\d+(?:m\d+)?$/i);
  return match ? match[1]! : null;
}

async function writeWithModel(
  client: PoolClient,
  view: LiveView,
  userId: string,
): Promise<{ content: MatchBriefContent; model: string; writer: "ai" | "local" }> {
  const winChance = Math.round((view.ourAlliance === "red" ? view.prediction.pRed : view.prediction.pBlue) * 100);
  const teams = [...view.red, ...view.blue].map((teamKey) => teamKey.replace(/^frc/, ""));
  let adapter: Awaited<ReturnType<typeof resolveOrgChatAdapter>> | null = null;
  try {
    const promptCachingEnabled = await getOrgPromptCachingEnabled(client, view.orgId);
    adapter = await resolveOrgChatAdapter(client, {
      orgId: view.orgId,
      userId,
      promptCachingEnabled,
      feature: MATCH_BRIEF_FEATURE,
      bridgeTransport: createBridgeTransport(),
    });
  } catch {
    adapter = null;
  }
  if (adapter) {
    const message = buildMatchBriefPrompt(view);
    try {
      const raw = await meteredAI({
        client,
        orgId: view.orgId,
        userId,
        feature: MATCH_BRIEF_FEATURE,
        requestId: randomUUID(),
        estimatedCostUsd: 0.01,
        estimatedPromptTokens: Math.ceil(message.length / 4),
        estimatedCompletionTokens: 900,
        provider: adapter.provider,
        model: adapter.model,
        metadata: { matchKey: view.matchKey },
        invoke: async () => {
          const result = await adapter!.complete({ message, context: [] });
          return {
            value: result.text,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costUsd: result.costUsd,
            model: adapter!.model,
            provider: adapter!.provider,
            cacheReadInputTokens: result.cacheReadInputTokens,
            cacheWriteInputTokens: result.cacheWriteInputTokens,
            uncachedInputTokens: result.uncachedInputTokens,
          };
        },
      });
      const content = parseMatchBrief(raw, { winChance, teams });
      if (content) return { content, model: adapter.model, writer: "ai" };
    } catch (error) {
      // A spending cap or limit is the team's decision; say so instead of quietly writing locally.
      if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 402) throw error;
    }
  }
  return { content: composeLocalMatchBrief(view), model: "vantage-local", writer: "local" };
}

/**
 * The brief for our next (or a named) match. `mode: "ensure"` writes one only when there is none
 * or the stored one is out of date (the automatic path, run when someone opens the match page);
 * `mode: "regenerate"` always writes a new one (the button). Either way the newest is shared by
 * the whole team.
 */
export async function getOrWriteMatchBrief(
  client: PoolClient,
  input: { userId: string; userName: string | null; orgId: string | null; matchKey?: string | null; mode: "read" | "ensure" | "regenerate" },
): Promise<MatchBriefResult> {
  // Reading, and deciding whether a write is due, only need the stored plan and two counts. The
  // strategy computation (which also saves the prediction) runs only when a plan is written; the
  // page re-reads every minute for everyone viewing it, so that read has to stay cheap.
  if (input.orgId && input.matchKey && input.mode !== "regenerate") {
    const eventKey = eventKeyOfMatch(input.matchKey);
    if (eventKey) {
      const [existing, now] = await Promise.all([
        loadLatestMatchBrief(client, input.orgId, input.matchKey),
        loadBriefInputs(client, input.orgId, eventKey),
      ]);
      const stale = briefIsStale(existing, now);
      const due = input.mode === "ensure" && stale && !writtenJustNow(existing);
      if (!due) {
        return existing
          ? { status: "ready", brief: existing, stale, generated: false }
          : { status: "empty", matchKey: input.matchKey, message: "No brief for this match yet." };
      }
    }
  }
  const view = await computeStrategyView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    matchKey: input.matchKey ?? null,
  });
  if (view.status === "setup_required") return { status: "setup_required", message: view.message };
  if (view.status !== "live") {
    return { status: "empty", matchKey: null, message: "message" in view && typeof view.message === "string" ? view.message : "No upcoming match with data yet." };
  }
  const now = await loadBriefInputs(client, view.orgId, view.eventKey);
  const existing = await loadLatestMatchBrief(client, view.orgId, view.matchKey);
  const stale = briefIsStale(existing, now);
  const writeNow = input.mode === "regenerate" || (input.mode === "ensure" && stale && !writtenJustNow(existing));
  if (!writeNow) {
    return existing
      ? { status: "ready", brief: existing, stale, generated: false }
      : { status: "empty", matchKey: view.matchKey, message: "No brief for this match yet." };
  }
  const written = await writeWithModel(client, view, input.userId);
  const brief: MatchBrief = {
    ...written.content,
    kind: MATCH_BRIEF_KIND,
    matchKey: view.matchKey,
    alliance: view.ourAlliance,
    source: {
      lastPlayedMatch: now.lastPlayedMatch,
      scoutReports: now.scoutReports,
      generatedAt: new Date().toISOString(),
      generatedBy: input.userId,
      generatedByName: input.userName,
      trigger: input.mode === "regenerate" ? "manual" : "auto",
      model: written.model,
      writer: written.writer,
    },
  };
  await saveMatchBrief(client, { orgId: view.orgId, userId: input.userId, brief });
  return { status: "ready", brief, stale: false, generated: true };
}
