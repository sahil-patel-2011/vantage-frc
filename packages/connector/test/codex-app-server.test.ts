import { describe, expect, it } from "vitest";
import { runCodexTurn, type CodexRpc, type CodexRpcMessage } from "../src/codex-app-server.js";

function server(account: unknown = { type: "chatgpt" }) {
  let listener: (message: CodexRpcMessage) => void = () => {};
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const answers: Array<{ id: string | number; result: unknown }> = [];
  let closed = false;
  const rpc: CodexRpc = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "account/read") return { account };
      if (method === "thread/start") return { thread: { id: "private-thread" }, model: "reported-model" };
      if (method === "turn/start") {
        listener({ method: "turn/started", params: { threadId: "private-thread", turn: { id: "private-turn" } } });
        return { turn: { id: "private-turn" } };
      }
      return {};
    },
    notify: (method, params) => { calls.push({ method, params }); },
    respond: (id, result) => { answers.push({ id, result }); },
    listen: (callback) => { listener = callback; return () => { listener = () => {}; }; },
    close: () => { closed = true; },
  };
  return { rpc, calls, answers, send: (message: CodexRpcMessage) => listener(message), closed: () => closed };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("personal Codex App Server", () => {
  it("tests the actual personal account without starting a model turn or reading history", async () => {
    const fake = server();
    expect(await runCodexTurn({ rpc: fake.rpc, prompt: "", cwd: "/isolated-vantage", timeoutMs: 1000, testOnly: true })).toMatchObject({ ok: true, model: null });
    expect(fake.calls.map((call) => call.method)).toEqual(["initialize", "initialized", "account/read"]);
    expect(fake.closed()).toBe(true);
  });
  it("streams only its own ephemeral turn with actual usage and no history access", async () => {
    const fake = server();
    const deltas: string[] = [];
    const promise = runCodexTurn({ rpc: fake.rpc, prompt: "Analyze supplied match data", cwd: "/isolated-vantage", timeoutMs: 1000, onDelta: (text) => deltas.push(text) });
    await settle();
    fake.send({ method: "item/agentMessage/delta", params: { threadId: "other-terminal", turnId: "private-turn", delta: "PRIVATE" } });
    fake.send({ method: "item/agentMessage/delta", params: { threadId: "private-thread", turnId: "private-turn", delta: "Answer" } });
    fake.send({ method: "turn/completed", params: { threadId: "private-thread", turn: { id: "another-turn", status: "completed" } } });
    fake.send({ method: "thread/tokenUsage/updated", params: { threadId: "private-thread", tokenUsage: { last: { inputTokens: 43, outputTokens: 12 } } } });
    fake.send({ method: "turn/completed", params: { threadId: "private-thread", turn: { id: "private-turn", status: "completed" } } });
    expect(await promise).toEqual({ ok: true, text: "Answer", model: "reported-model", usage: { inputTokens: 43, outputTokens: 12 } });
    expect(deltas).toEqual(["Answer"]);
    expect(fake.calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ ephemeral: true, sandbox: "read-only", approvalPolicy: "on-request", config: { "features.shell_tool": false } });
    expect(fake.calls.some((call) => /thread\/(read|list|resume)|shellCommand|account\/login/.test(call.method))).toBe(false);
    expect(fake.closed()).toBe(true);
  });
  it("requires the local subscriber and does not import platform API credentials", async () => {
    for (const account of [null, { type: "apiKey" }]) {
      const fake = server(account);
      const result = await runCodexTurn({ rpc: fake.rpc, prompt: "test", cwd: "/isolated-vantage", timeoutMs: 1000 });
      expect(result).toMatchObject({ ok: false, errorClass: "not_authenticated" });
      expect(fake.calls.some((call) => call.method === "thread/start")).toBe(false);
    }
  });
  it("dispatches typed tools only within its own turn and leaves mutations as proposals", async () => {
    const fake = server();
    const executed: string[] = [];
    const tools = {
      list: () => [{ name: "vantage_cad_create_brief", description: "Propose a brief for confirmation", inputSchema: { type: "object" } }],
      call: async (name: string) => { executed.push(name); return { status: "proposed", requiresConfirmation: true, proposalId: "pending-proposal" }; },
    };
    const promise = runCodexTurn({ rpc: fake.rpc, prompt: "Propose a repair", cwd: "/isolated", timeoutMs: 1000, tools });
    await settle();
    expect(fake.calls.find((call) => call.method === "thread/start")?.params.dynamicTools).toEqual([{ type: "function", name: "vantage_cad_create_brief", description: "Propose a brief for confirmation", inputSchema: { type: "object" } }]);
    const params = { threadId: "private-thread", turnId: "private-turn", tool: "vantage_cad_create_brief", arguments: { request: "repair" }, callId: "call-1" };
    fake.send({ id: 10, method: "item/tool/call", params: { ...params, threadId: "another-person" } });
    fake.send({ id: 11, method: "item/tool/call", params: { ...params, turnId: "other-turn" } });
    fake.send({ id: 12, method: "item/tool/call", params: { ...params, tool: "shell" } });
    fake.send({ id: 13, method: "item/tool/call", params });
    await settle();
    expect(executed).toEqual(["vantage_cad_create_brief"]);
    expect(fake.answers.slice(0, 3).every((answer) => (answer.result as { success: boolean }).success === false)).toBe(true);
    expect(fake.answers[3]).toEqual({ id: 13, result: { success: true, contentItems: [{ type: "inputText", text: JSON.stringify({ status: "proposed", requiresConfirmation: true, proposalId: "pending-proposal" }) }] } });
    fake.send({ method: "item/agentMessage/delta", params: { threadId: "private-thread", turnId: "private-turn", delta: "Confirm the proposal in Vantage." } });
    fake.send({ method: "turn/completed", params: { threadId: "private-thread", turn: { id: "private-turn", status: "completed" } } });
    expect(await promise).toMatchObject({ ok: true });
  });
  it("declines filesystem approvals and interrupts when the person cancels", async () => {
    const fake = server();
    const controller = new AbortController();
    const promise = runCodexTurn({ rpc: fake.rpc, prompt: "test", cwd: "/isolated-vantage", timeoutMs: 1000, signal: controller.signal });
    await settle();
    fake.send({ id: 41, method: "item/commandExecution/requestApproval", params: { threadId: "private-thread", turnId: "private-turn", command: "unsafe" } });
    fake.send({ id: 42, method: "item/permissions/requestApproval", params: { threadId: "private-thread", turnId: "private-turn" } });
    expect(fake.answers).toEqual([{ id: 41, result: { decision: "decline" } }, { id: 42, result: { permissions: {}, scope: "turn" } }]);
    controller.abort();
    expect(await promise).toMatchObject({ ok: false, errorClass: "cancelled" });
    expect(fake.calls.find((call) => call.method === "turn/interrupt")?.params).toEqual({ threadId: "private-thread", turnId: "private-turn" });
  });
  it("reports provider throttling and bounds disconnected requests", async () => {
    const fake = server();
    const promise = runCodexTurn({ rpc: fake.rpc, prompt: "test", cwd: "/isolated-vantage", timeoutMs: 1000 });
    await settle();
    fake.send({ method: "turn/completed", params: { threadId: "private-thread", turn: { id: "private-turn", status: "failed", error: { message: "Usage limit reached; resets tomorrow." } } } });
    expect(await promise).toMatchObject({ ok: false, errorClass: "rate_limited", errorMessage: "Usage limit reached; resets tomorrow." });
    const disconnected = server();
    expect(await runCodexTurn({ rpc: disconnected.rpc, prompt: "test", cwd: "/isolated-vantage", timeoutMs: 5 })).toMatchObject({ ok: false, errorClass: "cli_timeout" });
  });
});
