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
};

export type RouteRequest = {
  capability: string;
  plan: string;
  paygEnabled: boolean;
  preferredDisplayName?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
};

export function routeModel(models: ModelConfig[], request: RouteRequest) {
  const candidates = models.filter(
    (model) =>
      model.enabled &&
      Boolean(model.providerModelId) &&
      model.capabilities.includes(request.capability) &&
      model.eligiblePlans.includes(request.plan) &&
      (!model.paygOnly || request.paygEnabled),
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
    billingBucket: chosen.paygOnly ? ("payg" as const) : ("included" as const),
    estimatedCostUsd:
      (chosen.inputPricePerMillionUsd * request.estimatedInputTokens +
        chosen.outputPricePerMillionUsd * request.estimatedOutputTokens) /
      1_000_000,
  };
}

export type ContextItem = {
  type: "private_memory" | "team_memory" | "module_data";
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
  }): Promise<{ text: string; promptTokens: number; completionTokens: number; costUsd: number }>;
}

export class LocalDeterministicChatAdapter implements ChatAdapter {
  readonly provider = "local";
  readonly model = "vantage-local-chat-v1";
  async complete(input: { message: string; context: ContextItem[] }) {
    const sources = input.context.map((item) => `${item.type}:${item.id}`).join(", ");
    const text = `Vantage response: ${input.message.trim()}${sources ? ` Context used: ${sources}.` : ""}`;
    return {
      text,
      promptTokens: Math.ceil((input.message.length + input.context.reduce((n, i) => n + i.content.length, 0)) / 4),
      completionTokens: Math.ceil(text.length / 4),
      costUsd: 0,
    };
  }
}

export { AgentRepository } from "./repository";
export * from "./providers";
