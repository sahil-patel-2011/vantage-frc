/**
 * Optional nudge on a statistical match forecast.
 *
 * The model is whichever chat adapter the org already configured. That can be
 * any provider the adapter supports. Anthropic Claude Haiku is one example of
 * that configuration; this file does not name or prefer a vendor.
 *
 * It may only return small point deltas, which are checked and clamped. A
 * missing, slow, or nonsense reply leaves the statistical forecast as it was.
 * Home shows the statistical card first. A follow-up request may run this
 * later, and only when both switches below are on. They stay off: no held-out
 * run has measured the nudge, and this environment has no model credential.
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  ChatProviderResolutionError,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance,
  type ChatAdapter,
} from "@vantage/agent";
import { wrapUntrusted } from "@vantage/agent/untrusted";
import { meteredAI } from "@vantage/billing";
import {
  PREDICTION_AI_ENABLED,
  SHIPPED_CATEGORY_MODEL,
  allianceWinProbability,
  applyBoundedAdjustment,
  type CategoryDeltas,
  type MatchForecast,
} from "@vantage/prediction-strategy";
import { createBridgeTransport } from "../ai-bridge/transport";

/** Code flag and env flag. Either one off and no model is called. */
export function predictionAiRequested(): boolean {
  return PREDICTION_AI_ENABLED && process.env.VANTAGE_PREDICTION_AI === "1";
}

export type ForecastAdjustment = {
  forecast: MatchForecast;
  aiUsed: boolean;
  note: string | null;
};

const unchanged = (forecast: MatchForecast): ForecastAdjustment => ({ forecast, aiUsed: false, note: null });

/**
 * One extra model completion when both flags are on and the caller passed a note.
 * Cost is whatever that completion's receipt says. It was not measured offline,
 * so this function does not invent a dollar figure (`estimatedCostUsd: 0`, same
 * as the other metered notes in the app).
 */
export async function maybeAdjustMatchForecast(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  forecast: MatchForecast;
  notes?: string | null;
}): Promise<ForecastAdjustment> {
  const notes = input.notes?.trim() ?? "";
  if (!predictionAiRequested() || !notes || !input.forecast.categoriesKnown) return unchanged(input.forecast);
  try {
    return await adjustWithMeteredModel({ ...input, notes });
  } catch {
    return unchanged(input.forecast);
  }
}

function parseDeltas(text: string): { red: CategoryDeltas; blue: CategoryDeltas } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { red?: CategoryDeltas; blue?: CategoryDeltas };
    if (!parsed || typeof parsed !== "object") return null;
    return { red: parsed.red ?? {}, blue: parsed.blue ?? {} };
  } catch {
    return null;
  }
}

async function adjustWithMeteredModel(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  forecast: MatchForecast;
  notes: string;
}): Promise<ForecastAdjustment> {
  const promptCachingEnabled = await getOrgPromptCachingEnabled(input.client, input.orgId).catch(() => true);
  let adapter: ChatAdapter;
  try {
    ({ adapter } = await resolveOrgChatAdapterWithProvenance(input.client, {
      orgId: input.orgId,
      userId: input.userId,
      promptCachingEnabled,
      feature: "chat",
      bridgeTransport: createBridgeTransport(),
    }));
  } catch (error) {
    if (error instanceof ChatProviderResolutionError) return unchanged(input.forecast);
    throw error;
  }

  const prompt = [
    "You adjust a match prediction that is already computed. Reply with JSON only.",
    "Keys: red and blue. Each may have auto, teleop, endgame, foul (a small point delta, not a score) and note (one short sentence).",
    "Do not invent a score. Deltas larger than a few points are thrown away.",
    `Statistical red total ${input.forecast.red.total}, blue total ${input.forecast.blue.total}.`,
    `Note from the team:\n${wrapUntrusted({ kind: "scouting_note", content: input.notes.slice(0, 600) })}`,
  ].join("\n");

  const text = await meteredAI({
    client: input.client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "match-prediction",
    requestId: `match-prediction-${randomUUID()}`,
    estimatedCostUsd: 0,
    estimatedPromptTokens: Math.ceil(prompt.length / 4),
    estimatedCompletionTokens: 120,
    provider: adapter.provider,
    model: adapter.model,
    metadata: { path: "match_prediction_adjustment" },
    invoke: async () => {
      const response = await adapter.complete({ message: prompt, context: [], promptCachingEnabled });
      return {
        value: response.text,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        costUsd: response.costUsd,
        model: adapter.model,
        provider: adapter.provider,
        cacheReadInputTokens: response.cacheReadInputTokens,
        cacheWriteInputTokens: response.cacheWriteInputTokens,
        uncachedInputTokens: response.uncachedInputTokens,
      };
    },
  });

  const deltas = parseDeltas(text);
  if (!deltas) return unchanged(input.forecast);
  const mean = (input.forecast.red.total + input.forecast.blue.total) / 2;
  const scale = mean > 0 ? SHIPPED_CATEGORY_MODEL.winShare * mean : 12;
  const adjusted = applyBoundedAdjustment({
    red: input.forecast.red,
    blue: input.forecast.blue,
    redWinProbability: input.forecast.redWinProbability,
    redDeltas: deltas.red,
    blueDeltas: deltas.blue,
    adjustedWinProbability: allianceWinProbability(
      input.forecast.red.total,
      input.forecast.blue.total,
      scale,
    ),
  });
  if (!adjusted.applied) return { forecast: input.forecast, aiUsed: false, note: adjusted.note };
  // Recompute the capped win chance from the clamped totals, not from the raw reply.
  const recast = applyBoundedAdjustment({
    red: input.forecast.red,
    blue: input.forecast.blue,
    redWinProbability: input.forecast.redWinProbability,
    redDeltas: deltas.red,
    blueDeltas: deltas.blue,
    adjustedWinProbability: allianceWinProbability(adjusted.red.total, adjusted.blue.total, scale),
  });
  return {
    forecast: {
      ...input.forecast,
      red: recast.red,
      blue: recast.blue,
      redWinProbability: recast.redWinProbability,
      confidence: recast.note ? `${input.forecast.confidence} ${recast.note}`.trim() : input.forecast.confidence,
    },
    aiUsed: true,
    note: recast.note,
  };
}
