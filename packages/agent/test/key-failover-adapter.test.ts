import { describe, expect, it, vi } from "vitest";
import { withServedKeyScope } from "@vantage/billing";
import { HttpChatAdapter, ProviderRateLimitError } from "../src/http-chat-adapter";
import { KeyFailoverChatAdapter, keyFailureReason, shouldFailOver, type FailoverKey } from "../src/key-failover-adapter";
import { ChatUpstreamTimeoutError } from "../src/chat-timeout";
import { resolveOrgChatAdapter } from "../src/resolve-chat-adapter";

function ok() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function keyed(fetchImpl: typeof fetch, ids: string[]): [FailoverKey, ...FailoverKey[]] {
  return ids.map((id) => ({
    id,
    label: `Team key ${id}`,
    scope: "org" as const,
    adapter: new HttpChatAdapter({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: `sk-${id}`,
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
      fetchImpl,
    }),
  })) as [FailoverKey, ...FailoverKey[]];
}

const bearer = (init?: RequestInit) => String((init?.headers as Record<string, string>)?.authorization ?? "");
const ask = { message: "hi", context: [] };

describe("KeyFailoverChatAdapter", () => {
  it("uses the first key that answers, in order, and records it for the usage row", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(bearer(init));
      return seen.length === 1 ? new Response("{}", { status: 503 }) : ok();
    });
    const results: Array<{ id: string; ok: boolean; reason: string | null }> = [];
    const adapter = new KeyFailoverChatAdapter(keyed(fetchImpl as never, ["a", "b", "c"]), (r) => {
      results.push({ id: r.key.id, ok: r.ok, reason: r.reason });
    });
    const { servedKey } = await withServedKeyScope(() => adapter.complete(ask));
    expect(seen).toEqual(["Bearer sk-a", "Bearer sk-b"]);
    expect(servedKey).toEqual({ id: "b", label: "Team key b", scope: "org" });
    expect(adapter.servedKey?.id).toBe("b");
    expect(results).toEqual([
      { id: "a", ok: false, reason: "Provider at capacity (503)" },
      { id: "b", ok: true, reason: null },
    ]);
    expect(JSON.stringify(results)).not.toContain("sk-");
  });

  it("throws the last refusal when every key is turned away", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429 }));
    const adapter = new KeyFailoverChatAdapter(keyed(fetchImpl as never, ["a", "b"]));
    await expect(adapter.complete(ask)).rejects.toBeInstanceOf(ProviderRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies which failures move to the next key", () => {
    expect(shouldFailOver(new ProviderRateLimitError("x", 429))).toBe(true);
    expect(shouldFailOver(new Error("openai API key was rejected (401 model=x). Update"))).toBe(true);
    expect(shouldFailOver(new Error("openai chat failed (500 model=x)"))).toBe(true);
    expect(shouldFailOver(new Error("openai chat failed (400 model=x)"))).toBe(false);
    expect(shouldFailOver(new ChatUpstreamTimeoutError(1))).toBe(false);
    expect(keyFailureReason(new ProviderRateLimitError("x", 402))).toBe("Out of credit or quota at the provider (402)");
  });
});

describe("team keys in the resolver", () => {
  it("skips switched-off keys in SQL and orders by the owner's order", async () => {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        if (sql.includes("FROM org_llm_keys")) {
          return {
            rows: [
              { id: "k1", provider: "openai", label: "Main", keyCiphertext: "c", keyNonce: "n", keyAuthTag: "t", encryptedDek: "d", kmsKeyId: "k" },
              { id: "k2", provider: "openai", label: "Backup", keyCiphertext: "c", keyNonce: "n", keyAuthTag: "t", encryptedDek: "d", kmsKeyId: "k" },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async (parts) => `sk-${parts.ciphertext}`,
    });
    const keysSql = sqls.find((sql) => sql.includes("FROM org_llm_keys"))!;
    expect(keysSql).toMatch(/COALESCE\(\(to_jsonb\(k\) ->> 'enabled'\)::boolean, true\)/);
    expect(keysSql).toMatch(/ORDER BY COALESCE\(\(to_jsonb\(k\) ->> 'priority'\)::int, 100\), k\.created_at/);
    expect(adapter).toBeInstanceOf(KeyFailoverChatAdapter);
    expect((adapter as KeyFailoverChatAdapter).keyCount).toBe(2);
  });
});
