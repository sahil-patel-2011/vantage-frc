import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter, ChatTurn } from "../src";
import { HttpChatAdapter } from "../src/http-chat-adapter";
import { AgentRepository } from "../src/repository";
import { buildBridgePromptDocument } from "../src/subscription-bridge-adapter";
import {
  estimateHistoryTokens,
  historyToPreamble,
  loadThreadHistory,
  trimThreadHistory,
} from "../src/thread-history";

vi.mock("@vantage/billing", async () => {
  const actual = await vi.importActual<typeof import("@vantage/billing")>("@vantage/billing");
  return {
    ...actual,
    meteredAI: vi.fn(async (input: { invoke: (k: string) => Promise<{ value: string }> }) => {
      const result = await input.invoke("byo");
      return result.value;
    }),
    loadOrgAiPolicy: vi.fn(async () => ({
      featureAllowlistEnabled: false,
      allowedFeatures: [],
      toolAllowlistEnabled: false,
      allowedTools: [],
      financeInAiEnabled: false,
      financeInAiAcceptedAt: null,
      financeInAiAckVersion: null,
      requireApprovalForFeatures: [],
      requireApprovalAboveThreshold: false,
      highCostThresholdUsd: null,
      adminBypassApproval: true,
    })),
    isToolAllowed: vi.fn(() => true),
  };
});

describe("trimThreadHistory", () => {
  it("keeps the newest turns under the char budget and starts with a user turn", () => {
    const turns: ChatTurn[] = [
      { role: "assistant", content: "stale opener" },
      { role: "user", content: "a".repeat(10) },
      { role: "assistant", content: "b".repeat(10) },
      { role: "user", content: "c".repeat(10) },
      { role: "assistant", content: "d".repeat(10) },
    ];
    const trimmed = trimThreadHistory(turns, { maxChars: 25 });
    expect(trimmed.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(trimmed[0]!.content).toBe("c".repeat(10));
  });

  it("caps at maxTurns, merges consecutive same-role turns and drops blanks", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "reply" },
    ];
    const trimmed = trimThreadHistory(turns, { maxTurns: 20 });
    expect(trimmed).toEqual([
      { role: "user", content: "one\n\ntwo" },
      { role: "assistant", content: "reply" },
    ]);
    const many = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as ChatTurn["role"],
      content: `t${i}`,
    }));
    expect(trimThreadHistory(many).length).toBe(20);
    expect(estimateHistoryTokens(trimThreadHistory(many))).toBeGreaterThan(0);
  });

  it("renders a preamble for single-prompt adapters", () => {
    const preamble = historyToPreamble([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(preamble).toContain("User: hi");
    expect(preamble).toContain("Assistant: hello");
    expect(historyToPreamble([])).toBe("");
    const doc = buildBridgePromptDocument({ message: `${preamble}next`, context: [] });
    expect(doc).toContain("CONVERSATION SO FAR");
    expect(doc).toContain("=== USER MESSAGE ===");
  });
});

describe("loadThreadHistory", () => {
  it("reads the last turns oldest-first and excludes the message being answered", async () => {
    const client = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        expect(params?.[0]).toBe("thread-1");
        expect(params?.[1]).toBe("msg-new");
        expect(params?.[2]).toBe(20);
        return {
          rows: [
            { role: "assistant", content: "second reply" },
            { role: "user", content: "second question" },
            { role: "assistant", content: "first reply" },
            { role: "user", content: "first question" },
          ],
          rowCount: 4,
        };
      }),
    } as unknown as PoolClient;
    const history = await loadThreadHistory(client, { threadId: "thread-1", excludeMessageId: "msg-new" });
    expect(history.map((t) => t.content)).toEqual([
      "first question",
      "first reply",
      "second question",
      "second reply",
    ]);
  });
});

describe("adapters carry history", () => {
  it("HttpChatAdapter sends prior turns as messages before the new one (OpenAI + Anthropic)", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const isAnthropic = String(_url).includes("/v1/messages");
      return new Response(
        JSON.stringify(
          isAnthropic
            ? { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }
            : { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const history: ChatTurn[] = [
      { role: "user", content: "what is our EPA" },
      { role: "assistant", content: "42" },
    ];
    const openai = new HttpChatAdapter({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "k",
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
      fetchImpl,
    });
    await openai.complete({ message: "and rank?", context: [], history });
    const anthropic = new HttpChatAdapter({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "k",
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
      fetchImpl,
    });
    await anthropic.complete({ message: "and rank?", context: [], history });

    const openaiMessages = bodies[0]!.messages as Array<{ role: string; content: string }>;
    expect(openaiMessages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(openaiMessages[1]!.content).toBe("what is our EPA");
    expect(openaiMessages[3]!.content).toBe("and rank?");
    const anthropicMessages = bodies[1]!.messages as Array<{ role: string; content: string }>;
    expect(anthropicMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(openai.prices.inputPerMillionUsd).toBe(0.4);
  });
});

describe("AgentRepository.sendMessage chat memory", () => {
  it("loads the thread's prior turns and hands them to the adapter as history", async () => {
    const historyRows = [
      { role: "assistant", content: "Your average EPA is 42." },
      { role: "user", content: "What is our average EPA?" },
    ];
    const seenSql: string[] = [];
    let insertedUserMessage = false;
    const client = {
      query: vi.fn(async (sql: string) => {
        seenSql.push(sql);
        if (sql.includes("INSERT INTO agent_messages") && sql.includes("'user'")) {
          insertedUserMessage = true;
          return { rows: [{ id: "msg-new" }], rowCount: 1 };
        }
        if (sql.includes("FROM agent_messages") && sql.includes("ORDER BY created_at DESC")) {
          expect(insertedUserMessage).toBe(true);
          return { rows: historyRows, rowCount: historyRows.length };
        }
        if (sql.includes("RETURNING id")) return { rows: [{ id: "row-1" }], rowCount: 1 };
        if (sql.includes("to_regclass")) {
          return { rows: [{ itemsPresent: false, sharingPresent: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    let received: ChatTurn[] | undefined;
    const adapter: ChatAdapter = {
      provider: "test",
      model: "test-model",
      prices: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
      async complete(input) {
        received = input.history;
        return { text: "Rank 5.", promptTokens: 10, completionTokens: 2, costUsd: 0 };
      },
    };

    const result = await new AgentRepository(client).sendMessage({
      userId: "user-1",
      orgId: "org-1",
      threadId: "thread-1",
      message: "And what rank does that put us at?",
      scope: "team",
      adapter,
      requestId: "req-1",
    });

    expect(received).toEqual([
      { role: "user", content: "What is our average EPA?" },
      { role: "assistant", content: "Your average EPA is 42." },
    ]);
    expect(result.text).toBe("Rank 5.");
    expect(result.historyTurns).toBe(2);
  });
});
