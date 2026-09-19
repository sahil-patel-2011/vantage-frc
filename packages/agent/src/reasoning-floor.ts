/**
 * How much reasoning a feature actually needs, and whether the model answering
 * it clears that bar.
 *
 * `model-tier.ts` says how capable the answering model is. This says how
 * capable the *task* needs it to be, which is the other half — and the half
 * that decides whether a wrong answer is embarrassing or expensive.
 *
 * The rule this encodes: **every feature keeps working on every key.** A team
 * running Ollama on a shop laptop is not locked out of the strategy tools.
 * But a task that has to weigh six robots against each other and justify a
 * pick is not the same task as writing a title, and a small model that fails
 * the second is merely rough while a small model that fails the first produces
 * a confident pick list that loses an alliance selection. So the floor does
 * three things, in order:
 *
 *   1. **Prefer** a model that clears the bar, when the org has one available.
 *   2. **Run anyway** on whatever is configured when it does not.
 *   3. **Say so**, on the surface that shows the answer, in words that tell
 *      the reader what to do about it.
 *
 * It never refuses. A student at a competition with a free key and no signal
 * needs the rough answer far more than they need a correctness lecture.
 */

import { classifyModelTier, type ModelTier, type ModelTierInput } from "./model-tier";

/**
 * Three classes, not one per feature.
 *
 * A list with forty entries goes stale the week somebody adds the
 * forty-first, and nobody notices because nothing fails.
 */
export type ReasoningNeed =
  /**
   * Multi-step judgement where being wrong is worse than being vague: ranking
   * robots, justifying a pick, planning CAD, critiquing a decision, reviewing
   * code. A weak model does not say "I am not sure" here — it invents a
   * confident ordering, and a confident wrong pick list is acted on.
   */
  | "reasoning"
  /**
   * Summarise, extract, rewrite, answer from a source that is in front of it.
   * A smaller model is rougher and still useful, because the facts are given
   * rather than inferred.
   */
  | "standard"
  /**
   * Naming, tagging, classifying, tidying. Anything competent does this.
   */
  | "light";

/**
 * Which features need real reasoning.
 *
 * Membership is decided by one question: if this is wrong, does somebody act
 * on it before noticing? A bad match brief gets re-read. A bad pick list gets
 * used on Saturday afternoon.
 */
const REASONING_FEATURES: ReadonlySet<string> = new Set([
  "agent",
  "autonomous",
  "bugbot",
  "cad",
  "cad_brief",
  "cad_change_radar",
  "code_perf",
  "decision_critic",
  "decision_search",
  "defense_planner",
  "inspection_copilot",
  "judge_sim",
  "match_copilot",
  "match_strategy",
  "picklist_justifier",
  "prediction_explain",
  "rule_impact",
  "strategy",
]);

/** Features where a smaller model is rough rather than dangerous. */
const LIGHT_FEATURES: ReadonlySet<string> = new Set([
  "auto_tag",
  "media_caption",
  "title_suggest",
  "team_tags",
]);

export function reasoningNeedFor(feature: string | null | undefined): ReasoningNeed {
  const key = (feature ?? "").trim().toLowerCase();
  if (REASONING_FEATURES.has(key)) return "reasoning";
  if (LIGHT_FEATURES.has(key)) return "light";
  return "standard";
}

/** Higher is more capable. `unknown` deliberately sits above small-or-local. */
const TIER_RANK: Record<ModelTier, number> = {
  frontier: 3,
  unknown: 2,
  capable: 1,
  "small-or-local": 0,
};

/**
 * The lowest tier that clears each bar.
 *
 * `reasoning` requires frontier — Claude Sonnet / Opus, GPT-5 / 4.1, Gemini
 * Pro class. Haiku-class models are deliberately below it: they are fast and
 * genuinely capable at summarising, and they are not what should be ranking an
 * alliance.
 */
const FLOOR: Record<ReasoningNeed, ModelTier> = {
  reasoning: "frontier",
  standard: "capable",
  light: "small-or-local",
};

export type ReasoningFloorResult = {
  need: ReasoningNeed;
  tier: ModelTier;
  /** True when the answering model is at or above what the task wants. */
  meetsFloor: boolean;
  /**
   * What to tell the reader, or null when there is nothing worth saying.
   * Never alarmist, and always ends with the thing they can do.
   */
  notice: string | null;
};

function noticeFor(need: ReasoningNeed, tier: ModelTier, modelId: string): string | null {
  const name = modelId.trim() || "the configured model";
  if (need !== "reasoning") {
    // A rough summary is still a summary. Model-tier's own notice covers this.
    return null;
  }
  if (tier === "small-or-local") {
    return `${name} is a small model, and this screen asks for judgement rather than a summary. Treat the ordering as a starting point and check it against the match data yourself. A Claude Sonnet, GPT-4.1, or Gemini Pro class key under Team → AI keys gives noticeably better reasoning here.`;
  }
  if (tier === "capable") {
    return `${name} is fast but built for summarising rather than weighing options. It will answer; a Sonnet, GPT-4.1, or Gemini Pro class model reasons through this kind of comparison more reliably.`;
  }
  if (tier === "unknown") {
    return `${name} is a custom model. This screen asks for judgement rather than a summary, so check its reasoning against the match data before acting on it.`;
  }
  return null;
}

/**
 * Does the model answering this feature clear the bar the feature wants?
 *
 * Pure: no env, no IO, no provider call. Callers pass the provenance they
 * already resolved.
 */
export function checkReasoningFloor(input: {
  feature: string | null | undefined;
  model: ModelTierInput;
}): ReasoningFloorResult {
  const need = reasoningNeedFor(input.feature);
  const { tier } = classifyModelTier(input.model);
  const meetsFloor = TIER_RANK[tier] >= TIER_RANK[FLOOR[need]];
  return {
    need,
    tier,
    meetsFloor,
    notice: meetsFloor ? null : noticeFor(need, tier, input.model.modelId ?? ""),
  };
}

/**
 * Order candidate models so a reasoning task reaches for the strongest first.
 *
 * Stable within a tier, so a team that pinned an order keeps it and only the
 * bar moves things. Does not drop anything: the weakest model still ends up in
 * the list, because running is better than refusing.
 */
export function preferForReasoning<T extends ModelTierInput>(
  candidates: readonly T[],
  feature: string | null | undefined,
): T[] {
  if (reasoningNeedFor(feature) !== "reasoning") return [...candidates];
  return [...candidates]
    .map((candidate, index) => ({ candidate, index, rank: TIER_RANK[classifyModelTier(candidate).tier] }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((row) => row.candidate);
}
