/**
 * Optional Freebuff pass over the deterministic role map.
 * If no org, no keys, or the model is down, the fallback is the answer.
 */

import { resolveOrgChatAdapter } from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import type { PoolClient } from "@neondatabase/serverless";
import { ISLAND_TAB_CATALOG } from "../nav/product-nav";
import {
  clampGreetingHint,
  clampPersonalizedIsland,
  personalizeFromRoles,
  type PersonalizeInput,
  type RolePersonalization,
} from "./personalize";

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function personalizeWithFreebuff(
  client: PoolClient,
  input: PersonalizeInput & { orgId: string | null; userId: string },
): Promise<RolePersonalization> {
  const fallback = personalizeFromRoles(input);
  if (!input.orgId) return fallback;

  try {
    const adapter = await resolveOrgChatAdapter(client, {
      orgId: input.orgId,
      userId: input.userId,
      promptCachingEnabled: true,
      feature: "onboarding_personalize",
      taskText: "Pick four island apps for this FRC member from an allowlist.",
    });

    const catalog = ISLAND_TAB_CATALOG.map((item) => `${item.href} (${item.label})`).join(", ");
    const text = await meteredAI({
      client,
      orgId: input.orgId,
      userId: input.userId,
      feature: "onboarding_personalize",
      requestId: `onboarding-personalize-${input.userId}`,
      estimatedCostUsd: adapter.estimateCostUsd?.(200, 80) ?? 0,
      invoke: async () => {
        const result = await adapter.complete({
          message: [
            "Return JSON only: {\"islandHrefs\":[\"href\",\"href\",\"href\",\"href\"],\"greetingHint\":\"one sentence\"}.",
            `Allowlisted hrefs: ${catalog}.`,
            "Exactly four unique hrefs from that list. Home (/dashboard) must be first.",
            "greetingHint: one sentence, no numbers, no DEMO, no fabricated stats.",
            `Identity roles: ${String(input.teamRole ?? "unset")}.`,
            `Crew jobs: ${String(input.crewRole ?? "unset")}.`,
            `Focus: ${String(input.primaryFocus ?? "unset")}.`,
            `Fallback island: ${fallback.islandHrefs.join(", ")}.`,
          ].join("\n"),
          context: [],
        });
        return {
          value: result.text,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costUsd: result.costUsd,
          model: adapter.model,
          provider: adapter.provider,
        };
      },
    });

    const parsed = extractJsonObject(typeof text === "string" ? text : "");
    if (!parsed) return fallback;
    const clamped = clampPersonalizedIsland(parsed.islandHrefs, fallback);
    return {
      ...clamped,
      greetingHint: clampGreetingHint(parsed.greetingHint, fallback.greetingHint),
    };
  } catch {
    return fallback;
  }
}
