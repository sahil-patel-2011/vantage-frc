import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter } from "../src";
import { ChatProviderResolutionError, type ResolvedOrgChatAdapter } from "../src/resolve-chat-adapter";
import {
  applyEditableFields,
  buildStructuredPrompt,
  classifyRenderFailure,
  parseJsonLoose,
  renderStructuredWithModel,
  renderWithModel,
  structureMatches,
} from "../src/render";

type Query = { sql: string; params?: unknown[] };

function fakeClient() {
  const queries: Query[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client: client as unknown as PoolClient, queries };
}

function fakeAdapter(
  reply: (() => Promise<string>) | string,
  options?: { provider?: string; model?: string },
): ChatAdapter {
  return {
    provider: options?.provider ?? "anthropic",
    model: options?.model ?? "claude-sonnet-4-20250514",
    prices: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
    async complete() {
      const text = typeof reply === "string" ? reply : await reply();
      return { text, promptTokens: 120, completionTokens: 40, costUsd: 0.00096 };
    },
  };
}

function resolved(adapter: ChatAdapter): ResolvedOrgChatAdapter {
  return {
    adapter,
    provenance: { provider: adapter.provider, modelId: adapter.model, baseUrlOrigin: null, source: "org-key" },
  };
}

/** meteredAI stand-in: runs invoke and returns its value (no billing tables in unit tests). */
const passthroughMeter = async <T,>(input: { invoke: (k: "byo") => Promise<{ value: T }> }) =>
  (await input.invoke("byo")).value;

const attemptRows = (queries: Query[]) =>
  queries.filter((q) => q.sql.includes("INSERT INTO ai_render_attempts")).map((q) => q.params!);

describe("renderWithModel", () => {
  const base = { feature: "season_report", orgId: "org-1", userId: "user-1", prompt: "Write it." };

  it("uses the model when it answers and records a model attempt with real usage", async () => {
    const { client, queries } = fakeClient();
    const template = vi.fn(() => "TEMPLATE");
    const result = await renderWithModel({
      ...base,
      client,
      template,
      resolveAdapter: async () => resolved(fakeAdapter("Model prose.")),
      metered: passthroughMeter as never,
    });
    expect(result.mode).toBe("model");
    expect(result.text).toBe("Model prose.");
    expect(result.modelId).toBe("claude-sonnet-4-20250514");
    expect(result.fallbackReason).toBeUndefined();
    expect(template).not.toHaveBeenCalled();
    const rows = attemptRows(queries);
    expect(rows).toHaveLength(1);
    // (org_id, feature, mode, model_id, provider, fallback_reason, prompt_tokens, completion_tokens, cost_usd, created_by)
    expect(rows[0]![2]).toBe("model");
    expect(rows[0]![6]).toBe(120);
    expect(rows[0]![7]).toBe(40);
    expect(rows[0]![8]).toBeCloseTo(0.00096, 6);
  });

  it("passes a real cost estimate to the meter, never 0 for a paid provider", async () => {
    const { client } = fakeClient();
    let seen: { estimatedCostUsd: number; feature: string; provider?: string } | null = null;
    await renderWithModel({
      ...base,
      client,
      template: () => "T",
      resolveAdapter: async () => resolved(fakeAdapter("ok")),
      metered: (async (input: { estimatedCostUsd: number; feature: string; provider?: string; invoke: (k: "byo") => Promise<{ value: unknown }> }) => {
        seen = { estimatedCostUsd: input.estimatedCostUsd, feature: input.feature, provider: input.provider };
        return (await input.invoke("byo")).value;
      }) as never,
    });
    expect(seen).not.toBeNull();
    expect(seen!.feature).toBe("season_report");
    expect(seen!.provider).toBe("anthropic");
    expect(seen!.estimatedCostUsd).toBeGreaterThan(0);
  });

  const fallbackMatrix: Array<{
    name: string;
    resolveAdapter?: () => Promise<ResolvedOrgChatAdapter>;
    metered?: unknown;
    reply?: string;
    reason: string;
  }> = [
    {
      name: "no provider key",
      resolveAdapter: async () => {
        throw new ChatProviderResolutionError("No AI provider key is configured");
      },
      reason: "no_provider",
    },
    {
      name: "hard usage cutoff (cap hit)",
      metered: async () => {
        const error = new Error("cutoff");
        error.name = "UsageHardCutoffError";
        (error as Error & { reason: string }).reason = "payg_not_enabled";
        throw error;
      },
      reason: "cap_hit:payg_not_enabled",
    },
    {
      name: "approval required",
      metered: async () => {
        const error = new Error("hold");
        error.name = "ApprovalRequiredError";
        throw error;
      },
      reason: "approval_required",
    },
    {
      name: "upstream timeout",
      metered: async () => {
        const error = new Error("Upstream model timed out after 50000ms");
        error.name = "ChatUpstreamTimeoutError";
        throw error;
      },
      reason: "timeout",
    },
    {
      name: "provider error",
      metered: async () => {
        throw new Error("anthropic chat failed (500 model=x)");
      },
      reason: "provider_error",
    },
    { name: "empty output", reply: "   ", reason: "empty_output" },
    { name: "placeholder output", reply: "No response.", reason: "empty_output" },
  ];

  for (const entry of fallbackMatrix) {
    it(`falls back to the template on ${entry.name}`, async () => {
      const { client, queries } = fakeClient();
      const result = await renderWithModel({
        ...base,
        client,
        template: () => "TEMPLATE",
        resolveAdapter: entry.resolveAdapter ?? (async () => resolved(fakeAdapter(entry.reply ?? "x"))),
        metered: (entry.metered ?? passthroughMeter) as never,
      });
      expect(result.mode).toBe("template");
      expect(result.text).toBe("TEMPLATE");
      expect(result.fallbackReason).toBe(entry.reason);
      const rows = attemptRows(queries);
      expect(rows).toHaveLength(1);
      expect(rows[0]![2]).toBe("template");
      expect(rows[0]![5]).toBe(entry.reason);
      expect(rows[0]![8]).toBe(0);
    });
  }

  it("rejects model output the accept() guard refuses", async () => {
    const { client } = fakeClient();
    const result = await renderWithModel({
      ...base,
      client,
      template: () => "TEMPLATE",
      accept: (text) => text.startsWith("OK:"),
      resolveAdapter: async () => resolved(fakeAdapter("not ok")),
      metered: passthroughMeter as never,
    });
    expect(result.mode).toBe("template");
    expect(result.fallbackReason).toBe("rejected_output");
  });

  it("never lets a missing ai_render_attempts table break the feature", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO ai_render_attempts")) {
          const error = new Error('relation "ai_render_attempts" does not exist');
          (error as Error & { code: string }).code = "42P01";
          throw error;
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const result = await renderWithModel({
      ...base,
      client,
      template: () => "TEMPLATE",
      resolveAdapter: async () => resolved(fakeAdapter("Model prose.")),
      metered: passthroughMeter as never,
    });
    expect(result.mode).toBe("model");
    expect(result.text).toBe("Model prose.");
  });

  it("rolls back to the savepoint only for SQL failures inside the meter", async () => {
    const { client, queries } = fakeClient();
    await renderWithModel({
      ...base,
      client,
      template: () => "T",
      resolveAdapter: async () => resolved(fakeAdapter("x")),
      metered: (async () => {
        const error = new Error("current transaction is aborted");
        (error as Error & { code: string }).code = "25P02";
        throw error;
      }) as never,
    });
    expect(queries.some((q) => q.sql === "ROLLBACK TO SAVEPOINT ai_render_model")).toBe(true);

    const second = fakeClient();
    await renderWithModel({
      ...base,
      client: second.client,
      template: () => "T",
      resolveAdapter: async () => resolved(fakeAdapter("x")),
      metered: (async () => {
        throw new Error("provider down");
      }) as never,
    });
    expect(second.queries.some((q) => q.sql === "ROLLBACK TO SAVEPOINT ai_render_model")).toBe(false);
    expect(second.queries.some((q) => q.sql === "RELEASE SAVEPOINT ai_render_model")).toBe(true);
  });
});

describe("classifyRenderFailure", () => {
  it("maps billing kill switch and policy denials", () => {
    const killed = new Error("disabled");
    killed.name = "BillingDisabledError";
    expect(classifyRenderFailure(killed)).toBe("cap_hit:kill_switch");
    const denied = new Error("nope");
    denied.name = "AiPolicyDeniedError";
    expect(classifyRenderFailure(denied)).toBe("policy_denied");
    expect(classifyRenderFailure(new Error("Billing account is not configured"))).toBe("billing_not_configured");
    expect(classifyRenderFailure(new Error("The subscription bridge did not answer in time."))).toBe("timeout");
  });
});

describe("structured rendering", () => {
  const value = {
    verdict: "adopt",
    confidence: 0.72,
    concerns: ["Weight margin is thin."],
    recommendation: "Proceed, but weigh the assembly first.",
    items: [{ id: "a", rationale: "Because A." }],
  };

  it("accepts same-shape JSON with only editable prose rewritten", () => {
    const edited = {
      ...value,
      recommendation: "Go ahead — just put the assembly on the scale before you commit.",
      items: [{ id: "a", rationale: "A is the heaviest contributor." }],
    };
    expect(structureMatches(value, edited, ["recommendation", "rationale"])).toBe(true);
  });

  it("rejects changed numbers, enums, ids, extra keys and array length", () => {
    const keys = ["recommendation", "rationale"];
    expect(structureMatches(value, { ...value, confidence: 0.9 }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, verdict: "reject" }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, extra: 1 }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, items: [] }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, items: [{ id: "b", rationale: "x" }] }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, recommendation: "" }, keys)).toBe(false);
    expect(structureMatches(value, { ...value, concerns: ["changed"] }, keys)).toBe(false);
  });

  it("applies only editable fields onto the template", () => {
    const applied = applyEditableFields(
      value,
      { ...value, confidence: 0.99, recommendation: "New text", items: [{ id: "zzz", rationale: "New A." }] },
      ["recommendation", "rationale"],
    );
    expect(applied.confidence).toBe(0.72);
    expect(applied.recommendation).toBe("New text");
    expect(applied.items[0]!.id).toBe("a");
    expect(applied.items[0]!.rationale).toBe("New A.");
  });

  it("parses fenced JSON and rejects prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
    expect(parseJsonLoose("no json here")).toBeNull();
  });

  it("renderStructuredWithModel keeps numbers from the template and prose from the model", async () => {
    const { client } = fakeClient();
    const modelJson = JSON.stringify({
      ...value,
      confidence: 0.1,
      recommendation: "Model recommendation.",
      items: [{ id: "a", rationale: "Model rationale." }],
    });
    // confidence differs → structure mismatch → template
    const rejected = await renderStructuredWithModel({
      feature: "decision_critic",
      orgId: "org-1",
      userId: "user-1",
      client,
      value,
      editableKeys: ["recommendation", "rationale"],
      instructions: "Critique.",
      resolveAdapter: async () => resolved(fakeAdapter(modelJson)),
      metered: passthroughMeter as never,
    });
    expect(rejected.render.mode).toBe("template");
    expect(rejected.render.fallbackReason).toBe("rejected_output");
    expect(rejected.value).toEqual(value);

    const goodJson = JSON.stringify({
      ...value,
      recommendation: "Model recommendation.",
      items: [{ id: "a", rationale: "Model rationale." }],
    });
    const accepted = await renderStructuredWithModel({
      feature: "decision_critic",
      orgId: "org-1",
      userId: "user-1",
      client,
      value,
      editableKeys: ["recommendation", "rationale"],
      instructions: "Critique.",
      resolveAdapter: async () => resolved(fakeAdapter(goodJson)),
      metered: passthroughMeter as never,
    });
    expect(accepted.render.mode).toBe("model");
    expect(accepted.value.confidence).toBe(0.72);
    expect(accepted.value.recommendation).toBe("Model recommendation.");
    expect(accepted.value.items[0]!.rationale).toBe("Model rationale.");
  });

  it("builds a prompt that names the editable keys and embeds the JSON", () => {
    const prompt = buildStructuredPrompt({ instructions: "Do it.", editableKeys: ["rationale"], value: { rationale: "r" } });
    expect(prompt).toContain('"rationale"');
    expect(prompt).toContain('{"rationale":"r"}');
    expect(prompt).toContain("Return ONLY the JSON");
  });
});
