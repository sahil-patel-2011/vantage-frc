import { describe, expect, it } from "vitest";
import {
  AI_HORDE_ANONYMOUS_KEY,
  AI_HORDE_MODEL_IDS,
  AI_HORDE_MAX_PROMPT_CHARS,
  AiHordeAdapter,
  aiHordeApiKey,
  aiHordeBaseUrl,
  aiHordeRequestModels,
  buildAiHordePrompt,
  isAiHordeEnabled,
  isAiHordeModel,
  sanitizeAiHordeContext,
  tryCreateAiHordeAdapter,
  AI_HORDE_STOP_SEQUENCES,
  trimAiHordeCompletion,
  looksLikePromptEcho,
} from "../src/ai-horde-pool";
import type { ContextItem } from "../src/index";

const ctx = (type: ContextItem["type"], id: string, content: string): ContextItem =>
  ({ type, id, content }) as ContextItem;

/** A fetch that walks a scripted submit → poll → done sequence. */
function scriptedFetch(steps: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let index = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: (step.status ?? 200) < 400,
      status: step.status ?? 200,
      json: async () => step.body,
      text: async () => JSON.stringify(step.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const adapter = (fetchImpl: typeof fetch, model?: string | null) =>
  new AiHordeAdapter({
    baseUrl: "https://aihorde.test/api/v2",
    apiKey: "k",
    capability: "chat",
    model: model ?? null,
    fetchImpl,
    timeoutMs: 0,
    pollMs: 0,
    waitMs: 5_000,
  });

describe("which models Vantage will take an answer from", () => {
  it("asks for the allowlist and nothing else", () => {
    // The swarm's large models are roleplay and deliberately-uncensored
    // community builds. The request's model list is what stops one of them
    // answering a student, so it is never open-ended.
    expect(aiHordeRequestModels(null)).toEqual([...AI_HORDE_MODEL_IDS]);
    expect(AI_HORDE_MODEL_IDS.every((id) => /instruct/i.test(id))).toBe(true);
  });

  it("narrows to one when a team has chosen", () => {
    expect(aiHordeRequestModels(AI_HORDE_MODEL_IDS[1]!)).toEqual([AI_HORDE_MODEL_IDS[1]]);
  });

  it("ignores a model that is not on the list rather than asking for it", () => {
    // The dangerous shape: a stored preference, or a tampered request, naming
    // something the swarm hosts and we would never choose.
    for (const bad of [
      "koboldcpp/ReadyArt/Forgotten-Safeword-22B",
      "koboldcpp/Judas-Uncensored-3.2-1B.Q8",
      "koboldcpp/gemma-4-31B-it-heretic",
      "",
      null,
      undefined,
    ]) {
      expect(isAiHordeModel(bad), String(bad)).toBe(false);
      expect(aiHordeRequestModels(bad as string | null)).toEqual([...AI_HORDE_MODEL_IDS]);
    }
  });

  it("does not let an unlisted model into the request even through the constructor", async () => {
    // The constructor is the last place a bad model could get in — from a
    // stored org preference, or an env var somebody set by hand.
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: "hi" }] } },
    ]);
    await adapter(scripted.impl, "koboldcpp/ReadyArt/Forgotten-Safeword-22B").complete({
      message: "q",
      context: [],
    });
    const submitted = scripted.calls[0]!.body as { models: string[] };
    expect(submitted.models).toEqual([...AI_HORDE_MODEL_IDS]);
    expect(submitted.models).not.toContain("koboldcpp/ReadyArt/Forgotten-Safeword-22B");
  });
});

describe("what leaves for a volunteer's machine", () => {
  it("drops private context entirely", () => {
    const kept = sanitizeAiHordeContext([
      ctx("private_memory", "p1", "Jordan's parents are divorcing"),
      ctx("module_data", "s1", "254 scored 40"),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe("s1");
  });

  it("keeps private context out of the built prompt too", () => {
    const prompt = buildAiHordePrompt({
      message: "how did we do",
      context: [ctx("private_memory", "p1", "SECRET-MEMORY"), ctx("module_data", "s1", "254 scored 40")],
    });
    expect(prompt).not.toContain("SECRET-MEMORY");
    expect(prompt).toContain("254 scored 40");
  });

  it("keeps the question when it has to trim", () => {
    // Trimming from the front costs system-prompt rules; trimming from the
    // back would cost the question itself.
    const prompt = buildAiHordePrompt({
      message: "THE-ACTUAL-QUESTION",
      context: [ctx("module_data", "s1", "x".repeat(AI_HORDE_MAX_PROMPT_CHARS * 2))],
    });
    expect(prompt.length).toBeLessThanOrEqual(AI_HORDE_MAX_PROMPT_CHARS);
    expect(prompt).toContain("THE-ACTUAL-QUESTION");
  });
});

describe("talking to the swarm", () => {
  it("submits, polls, and returns the answer at no cost", async () => {
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: false, is_possible: true, queue_position: 2 } },
      { body: { done: true, generations: [{ text: "  Build the climber.  ", model: AI_HORDE_MODEL_IDS[0] }] } },
    ]);
    const result = await adapter(scripted.impl).complete({ message: "what next", context: [] });
    expect(result.text).toBe("Build the climber.");
    expect(result.costUsd).toBe(0);
    expect(scripted.calls[0]!.method).toBe("POST");
    expect(scripted.calls[0]!.url).toContain("/generate/text/async");
  });

  it("records the model that actually answered, not the one asked for", async () => {
    // Asked for all three; a volunteer hosting the compressed one took it.
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: "ok", model: AI_HORDE_MODEL_IDS[1] }] } },
    ]);
    const subject = adapter(scripted.impl);
    await subject.complete({ message: "q", context: [] });
    // The billing receipt reads this after complete() resolves, so this is
    // what lands in the usage ledger.
    expect(subject.model).toBe(AI_HORDE_MODEL_IDS[1]);
  });

  it("does not believe a worker that claims an unlisted model", async () => {
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: "ok", model: "koboldcpp/Judas-Uncensored-3.2-1B.Q8" }] } },
    ]);
    const subject = adapter(scripted.impl, AI_HORDE_MODEL_IDS[0]);
    await subject.complete({ message: "q", context: [] });
    expect(subject.model).toBe(AI_HORDE_MODEL_IDS[0]);
  });

  it("says the swarm is empty rather than waiting, when nobody hosts the models", async () => {
    // `is_possible: false` will not become true by waiting, and a team on a
    // competition day should not spend two minutes finding that out.
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: false, is_possible: false } },
    ]);
    await expect(adapter(scripted.impl).complete({ message: "q", context: [] })).rejects.toThrow(
      /empty rather than busy/i,
    );
  });

  it("reports a faulted job as worth retrying", async () => {
    const scripted = scriptedFetch([{ body: { id: "job-1" } }, { body: { faulted: true } }]);
    await expect(adapter(scripted.impl).complete({ message: "q", context: [] })).rejects.toThrow(
      /different machine/i,
    );
  });

  it("gives the queue slot back when it stops waiting", async () => {
    const scripted = scriptedFetch([{ body: { id: "job-1" } }, { body: { done: false, is_possible: true } }]);
    const subject = new AiHordeAdapter({
      baseUrl: "https://aihorde.test/api/v2",
      apiKey: "k",
      capability: "chat",
      fetchImpl: scripted.impl,
      timeoutMs: 0,
      pollMs: 0,
      waitMs: 10,
    });
    await expect(subject.complete({ message: "q", context: [] })).rejects.toThrow(/anonymous requests last/i);
    expect(scripted.calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("treats an empty completion as a fault rather than an answer", async () => {
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: "   " }] } },
    ]);
    await expect(adapter(scripted.impl).complete({ message: "q", context: [] })).rejects.toThrow();
  });
});

describe("turning it on", () => {
  it("is off unless asked for", () => {
    // Volunteers can read what is sent to them. That is a decision a team
    // makes, not one a missing API key makes for them.
    for (const value of [undefined, "", "0", "false", "off", "no"]) {
      expect(isAiHordeEnabled({ AI_HORDE_POOL: value } as NodeJS.ProcessEnv), String(value)).toBe(false);
    }
    for (const value of ["1", "true", "on", "yes", "YES"]) {
      expect(isAiHordeEnabled({ AI_HORDE_POOL: value } as NodeJS.ProcessEnv), value).toBe(true);
    }
    expect(tryCreateAiHordeAdapter({ env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(tryCreateAiHordeAdapter({ env: { AI_HORDE_POOL: "1" } as NodeJS.ProcessEnv })).not.toBeNull();
  });

  it("falls back to the anonymous key, which works and is slow", () => {
    expect(aiHordeApiKey({} as NodeJS.ProcessEnv)).toBe(AI_HORDE_ANONYMOUS_KEY);
    expect(aiHordeApiKey({ AI_HORDE_API_KEY: " abc " } as NodeJS.ProcessEnv)).toBe("abc");
  });

  it("tolerates a base URL with a trailing slash", () => {
    expect(aiHordeBaseUrl({ AI_HORDE_BASE_URL: "https://x.test/api/v2/" } as NodeJS.ProcessEnv)).toBe(
      "https://x.test/api/v2",
    );
  });
});

describe("the answer, and nothing the model copied from its prompt", () => {
  it("cuts a context block the model reproduced", () => {
    // Measured against the live swarm: a 3B model answered the question and
    // then carried on, reproducing the prompt's context verbatim — including
    // a strategy.private_edge fact. A student would have seen their team's
    // internal notes pasted under the reply.
    const raw = [
      "Make sure the pit crew is ready.",
      "",
      "[module_data:org-session] Workspace session context",
      '[module_fact:strategy.private_edge:0] {"tool":"strategy.private"}',
    ].join("\n");
    expect(trimAiHordeCompletion(raw)).toBe("Make sure the pit crew is ready.");
  });

  it("cuts a transcript the model kept writing", () => {
    expect(trimAiHordeCompletion("Short answer.\nUser: and then what\nAssistant: more")).toBe(
      "Short answer.",
    );
  });

  it("leaves an ordinary answer alone, including its own brackets", () => {
    const answer = "Check the battery [it is the usual one], then the tether.";
    expect(trimAiHordeCompletion(answer)).toBe(answer);
  });

  it("keeps a multi-line answer whole", () => {
    const answer = "First, weigh in.\nThen check the bumpers.";
    expect(trimAiHordeCompletion(answer)).toBe(answer);
  });

  it("returns nothing when the completion is only context", () => {
    // No answer in it at all. Empty reads as a fault, which is what it is.
    expect(trimAiHordeCompletion("[module_data:org-session] Workspace session")).toBe("");
    expect(trimAiHordeCompletion("  \n [team_memory:1] something")).toBe("");
  });

  it("asks the swarm to stop at those boundaries too", async () => {
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: "ok" }] } },
    ]);
    await adapter(scripted.impl).complete({ message: "q", context: [] });
    const params = (scripted.calls[0]!.body as { params: { stop_sequence?: string[] } }).params;
    // Both halves: the stop sequence prevents it, the trim handles a worker
    // whose backend ignores it.
    expect(params.stop_sequence).toEqual(AI_HORDE_STOP_SEQUENCES);
  });

  it("does not return a leaked context block as the answer", async () => {
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      {
        body: {
          done: true,
          generations: [{ text: "Answer here.\n[module_fact:strategy.private_edge:0] secret" }],
        },
      },
    ]);
    const result = await adapter(scripted.impl).complete({ message: "q", context: [] });
    expect(result.text).toBe("Answer here.");
    expect(result.text).not.toContain("private_edge");
  });
});

describe("a model that reads the prompt back instead of answering", () => {
  const PROMPT =
    "You are Vantage, an FRC (FIRST Robotics Competition) assistant. Answer from the team's own recorded data and never invent a score.";

  it("spots the system prompt coming back as an answer", () => {
    // Measured live: asked to say one word, the 1B model replied with the
    // opening of its own system prompt. There is no transcript marker in
    // front of that, so trimming cannot catch it.
    expect(looksLikePromptEcho(PROMPT, "You are Vantage, an FRC (FIRST Robotics Competition) assistant.")).toBe(
      true,
    );
  });

  it("does not mistake a real answer for an echo", () => {
    expect(
      looksLikePromptEcho(PROMPT, "Check the battery voltage and the tether before every match."),
    ).toBe(false);
  });

  it("leaves short answers alone", () => {
    // "Ready." is a fine answer and turns up inside all sorts of prompts. A
    // false positive here eats a good reply, which is the worse mistake.
    expect(looksLikePromptEcho(PROMPT, "Ready.")).toBe(false);
    expect(looksLikePromptEcho(PROMPT, "You are Vantage")).toBe(false);
  });

  it("ignores how the model broke its lines", () => {
    expect(looksLikePromptEcho(PROMPT, "You are Vantage, an FRC\n(FIRST Robotics Competition)\nassistant.")).toBe(
      true,
    );
  });

  it("reports an echo as something worth retrying, not as an answer", async () => {
    // Echo the real prompt this adapter would build, not an invented string —
    // the guard compares against what was actually sent, so a test that made
    // its own text would pass without exercising anything.
    const built = buildAiHordePrompt({ capability: "chat", message: "Say ready.", context: [] });
    const scripted = scriptedFetch([
      { body: { id: "job-1" } },
      { body: { done: true, generations: [{ text: built.slice(0, 120) }] } },
    ]);
    await expect(adapter(scripted.impl).complete({ message: "Say ready.", context: [] })).rejects.toThrow(
      /repeated the question back/i,
    );
  });
});
