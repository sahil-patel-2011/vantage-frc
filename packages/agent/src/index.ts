export type ModelConfig = {
  id: string;
  displayName: string;
  provider: string;
  providerModelId: string | null;
  inputPricePerMillionUsd: number;
  outputPricePerMillionUsd: number;
  capabilities: string[];
  eligiblePlans: string[];
  paygOnly: boolean;
  enabled: boolean;
  routingWeight: number;
  contextWindowTokens: number | null;
  fundingMode?: "managed_paid" | "byok" | "local" | "sponsored";
  commercialUseApproved?: boolean;
  commercialApprovalSource?: string | null;
  sponsoredEnabled?: boolean;
};

export type RouteRequest = {
  capability: string;
  plan: string;
  paygEnabled: boolean;
  preferredDisplayName?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  accountTier?: "free" | "paid";
};

export function routeModel(models: ModelConfig[], request: RouteRequest) {
  const candidates = models.filter(
    (model) =>
      model.enabled &&
      Boolean(model.providerModelId) &&
      model.capabilities.includes(request.capability) &&
      model.eligiblePlans.includes(request.plan) &&
      (!model.paygOnly || request.paygEnabled) &&
      model.provider.toLowerCase() !== "base44" &&
      (request.accountTier !== "free" ||
        model.fundingMode === "byok" ||
        model.fundingMode === "local" ||
        (model.fundingMode === "sponsored" &&
          model.sponsoredEnabled === true &&
          model.commercialUseApproved === true &&
          Boolean(model.commercialApprovalSource))),
  );
  const preferred = request.preferredDisplayName
    ? candidates.find((model) => model.displayName === request.preferredDisplayName)
    : undefined;
  const chosen =
    preferred ??
    candidates.sort((a, b) => {
      const aCost =
        (a.inputPricePerMillionUsd * request.estimatedInputTokens +
          a.outputPricePerMillionUsd * request.estimatedOutputTokens) /
        1_000_000 /
        Math.max(a.routingWeight, 0.01);
      const bCost =
        (b.inputPricePerMillionUsd * request.estimatedInputTokens +
          b.outputPricePerMillionUsd * request.estimatedOutputTokens) /
        1_000_000 /
        Math.max(b.routingWeight, 0.01);
      return aCost - bCost;
    })[0];
  if (!chosen) throw new Error("No configured model is eligible for this task and plan");
  return {
    ...chosen,
    billingBucket:
      chosen.fundingMode === "byok" || chosen.fundingMode === "local"
        ? ("external_provider" as const)
        : chosen.fundingMode === "sponsored"
          ? ("sponsored" as const)
          : chosen.paygOnly
            ? ("payg" as const)
            : ("included" as const),
    estimatedCostUsd:
      (chosen.inputPricePerMillionUsd * request.estimatedInputTokens +
        chosen.outputPricePerMillionUsd * request.estimatedOutputTokens) /
      1_000_000,
  };
}

export type ContextItem = {
  type:
    | "private_memory"
    | "team_memory"
    | "module_data"
    | "module_fact"
    | "artifact"
    | "task"
    | "github_file"
    | "vscode_selection";
  id: string;
  content: string;
  importance: number;
};

export function boundedContext(items: ContextItem[], tokenBudget: number) {
  let used = 0;
  const selected: ContextItem[] = [];
  for (const item of [...items].sort((a, b) => b.importance - a.importance)) {
    const estimated = Math.ceil(item.content.length / 4);
    if (used + estimated > tokenBudget) continue;
    selected.push(item);
    used += estimated;
  }
  return { items: selected, estimatedTokens: used };
}

export interface ChatAdapter {
  readonly provider: string;
  readonly model: string;
  complete(input: {
    message: string;
    context: ContextItem[];
    promptCachingEnabled?: boolean;
  }): Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    uncachedInputTokens?: number;
    cacheCostBasis?: string;
  }>;
}

export class LocalDeterministicChatAdapter implements ChatAdapter {
  readonly provider = "local";
  readonly model = "vantage-local-chat-v1";
  async complete(input: {
    message: string;
    context: ContextItem[];
    promptCachingEnabled?: boolean;
  }) {
    const { formatGroundedReply } = await import("./auto-tools");
    const { simulateLocalCacheUsage } = await import("./prompt-caching");
    const toolFacts = input.context.filter((item) => item.type === "module_fact");
    let text: string;
    if (toolFacts.length) {
      const annotated = toolFacts.map((item) => {
        try {
          const parsed = JSON.parse(item.content) as {
            tool?: string;
            status?: "ok" | "empty" | "setup_required";
            classification?: "hard_metric" | "scout_observation" | "researched_claim" | "model_inference";
            summary?: string;
            input?: unknown;
            dataSource?: {
              mode?: "ok" | "degraded" | "unavailable" | "stale";
              usingLastGoodCache?: boolean;
              message?: string;
            } | null;
          };
          return {
            name: parsed.tool ?? item.id,
            status: parsed.status ?? ("ok" as const),
            classification: parsed.classification ?? ("hard_metric" as const),
            summary: parsed.summary ?? "Tool result",
            output: parsed,
            input: parsed.input,
            dataSource:
              parsed.dataSource &&
              parsed.dataSource.mode &&
              parsed.dataSource.mode !== "ok" &&
              typeof parsed.dataSource.message === "string"
                ? {
                    mode: parsed.dataSource.mode,
                    usingLastGoodCache: Boolean(parsed.dataSource.usingLastGoodCache),
                    message: parsed.dataSource.message,
                  }
                : undefined,
          };
        } catch {
          return {
            name: item.id,
            status: "ok" as const,
            classification: "hard_metric" as const,
            summary: item.content.slice(0, 120),
            output: item.content,
          };
        }
      });
      text = formatGroundedReply(input.message, annotated);
    } else {
      const sources = input.context.map((item) => `${item.type}:${item.id}`).join(", ");
      text = `Vantage response: ${input.message.trim()}${sources ? ` Context used: ${sources}.` : ""}`;
    }
    const usage = simulateLocalCacheUsage({
      message: input.message,
      contextChars: input.context.reduce((n, item) => n + item.content.length, 0),
      completionChars: text.length,
      enabled: input.promptCachingEnabled ?? true,
    });
    return {
      text,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      uncachedInputTokens: usage.uncachedInputTokens,
      cacheCostBasis: usage.cacheCostBasis,
    };
  }
}

export { AgentRepository } from "./repository";
export * from "./providers";
export * from "./orchestrator";
export * from "./tools";
export * from "./auto-tools";
export * from "./prompt-caching";
export * from "./http-chat-adapter";
export * from "./hosted-platform-keys";
export * from "./resolve-chat-adapter";
export * from "./resolve-stt-endpoint";
export * from "./model-tier";
export * from "./sponsored-provider-pool";
export * from "./byok-model-routing";
export * from "./model-policy";
export * from "./coding-assistant";
export * from "./bugbot";
export * from "./brief-from-tools";
export * from "./cad-brief";
export * from "./rule-compliance";
export * from "./finance-redact";
export * from "./feature-context";
export * from "./season-year";
export * from "./chat-system-prompt";
export * from "./org-session-context";
export * from "./safe-web-fetch";
export * from "./web-tools";
export * from "./autonomous-agent-store";
export * from "./autonomous-loop";
export * from "./org-agent-rules";
export * from "./subscription-bridge-adapter";
