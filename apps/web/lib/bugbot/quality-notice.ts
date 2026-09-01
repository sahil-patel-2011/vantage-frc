/**
 * Quality notice for a Bugbot pass — same classifier and copy as chat.
 *
 * Ultra is hosted (`preferPlatform`) so it never claims a small-model
 * degradation. Subscription uses `classifyModelTier` + `degradedNoticeCopy`.
 * Unknown models stay honest: custom choice, no "worse / rougher" claim.
 */

import { classifyModelTier, degradedNoticeCopy } from "@vantage/agent/model-tier";

export type BugbotQualityNoticeMode = "subscription" | "ultra";

export type BugbotQualityNoticeInput = {
  mode: BugbotQualityNoticeMode;
  provider?: string | null;
  modelId?: string | null;
  /** Origin only (e.g. "http://127.0.0.1:11434") — never a full URL or key. */
  baseUrlOrigin?: string | null;
};

/**
 * One-line notice for the Bugbot response, or null when there is nothing to
 * say (Ultra, or a frontier hosted model on subscription).
 */
export function bugbotQualityNotice(input: BugbotQualityNoticeInput): string | null {
  if (input.mode === "ultra") return null;

  const modelId = input.modelId ?? "";
  const { tier } = classifyModelTier({
    provider: input.provider,
    modelId,
    baseUrlOrigin: input.baseUrlOrigin,
  });
  return degradedNoticeCopy(tier, modelId);
}
