export type CodexRpcMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
export type CodexRpc = {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params: Record<string, unknown>): void;
  respond(id: string | number, result: unknown): void;
  listen(listener: (message: CodexRpcMessage) => void): () => void;
  close(): void;
};
export type CodexTurnResult = { ok: true; text: string; model: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; errorClass: "not_authenticated" | "rate_limited" | "cli_error" | "cli_timeout" | "cancelled"; errorMessage: string };
export type CodexFeatureTools = {
  list(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
};
export type CodexTurnOptions = { rpc: CodexRpc; prompt: string; cwd: string; timeoutMs: number; signal?: AbortSignal; onDelta?: (text: string) => void; testOnly?: boolean; tools?: CodexFeatureTools };

/** A fresh ephemeral thread contains only this Vantage request. No terminal history APIs. */
export async function runCodexTurn(options: CodexTurnOptions): Promise<CodexTurnResult> {
  const { rpc } = options;
  let threadId: string | null = null;
  let turnId: string | null = null;
  let model: string | null = null;
  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let finished = false;
  let resolveOutcome!: (value: CodexTurnResult) => void;
  const outcome = new Promise<CodexTurnResult>((resolve) => { resolveOutcome = resolve; });
  const finish = (value: CodexTurnResult) => { if (!finished) { finished = true; resolveOutcome(value); } };
  const interrupt = (errorClass: "cancelled" | "cli_timeout") => {
    if (threadId && turnId) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    finish({ ok: false, errorClass, errorMessage: errorClass === "cancelled" ? "Your Vantage request was cancelled." : "Codex did not finish within the request's time limit." });
  };
  const abort = () => interrupt("cancelled");
  const timer = setTimeout(() => interrupt("cli_timeout"), options.timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  const unsubscribe = rpc.listen((message) => {
    if (message.method === "vantage/connectionClosed") {
      finish({ ok: false, errorClass: "cli_error", errorMessage: "The local Codex App Server disconnected." });
      return;
    }
    const params = message.params ?? {};
    if (message.id !== undefined && message.method) {
      if (message.method === "item/tool/call") {
        const id = message.id;
        const allowed = !finished && threadId && turnId && params.threadId === threadId && params.turnId === turnId
          && !params.namespace && typeof params.tool === "string" && options.tools?.list().some((tool) => tool.name === params.tool);
        if (!allowed) {
          rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: "This tool call does not belong to the active Vantage request." }] });
          return;
        }
        const args = params.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: "Tool arguments must be an object." }] });
          return;
        }
        void options.tools!.call(params.tool as string, args as Record<string, unknown>).then((value) => {
          if (!finished) rpc.respond(id, { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] });
        }).catch((error: unknown) => {
          if (!finished) rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: error instanceof Error ? error.message : "The Vantage tool failed." }] });
        });
        return;
      }
      // This chat transport cannot grant arbitrary shell, filesystem or account access.
      // Typed Vantage tools have a separate application permission/approval boundary.
      const method = message.method;
      if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") rpc.respond(message.id, { decision: "decline" });
      else if (method === "item/permissions/requestApproval") rpc.respond(message.id, { permissions: {}, scope: "turn" });
      else if (method === "mcpServer/elicitation/request") rpc.respond(message.id, { action: "decline", content: null });
      else if (method === "item/tool/requestUserInput") rpc.respond(message.id, { answers: {} });
      else rpc.respond(message.id, { success: false, contentItems: [{ type: "inputText", text: "This request is unavailable in Vantage chat." }] });
      return;
    }
    if (!threadId || params.threadId !== threadId || finished) return;
    const turn = params.turn as { id?: string; status?: string; error?: { message?: string; codexErrorInfo?: unknown } } | undefined;
    if (message.method === "turn/started" && turn?.id && !turnId) turnId = turn.id;
    const eventTurn = typeof params.turnId === "string" ? params.turnId : turn?.id;
    if (eventTurn && turnId && eventTurn !== turnId) return;
    if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      text += params.delta;
      options.onDelta?.(params.delta);
    }
    if (message.method === "item/completed") {
      const item = params.item as { type?: string; text?: string; phase?: string } | undefined;
      if (item?.type === "agentMessage" && typeof item.text === "string" && item.phase !== "commentary") text = item.text;
    }
    if (message.method === "thread/tokenUsage/updated") {
      const reported = params.tokenUsage as { last?: { inputTokens?: number; outputTokens?: number } } | undefined;
      if (reported?.last) usage = { inputTokens: reported.last.inputTokens ?? 0, outputTokens: reported.last.outputTokens ?? 0 };
    }
    if (message.method === "turn/completed") {
      if (turn?.status === "completed" && text) finish({ ok: true, text, model, usage });
      else {
        const errorMessage = turn?.error?.message ?? "Codex ended without a completed answer.";
        const errorClass = /rate.?limit|usage limit|quota|credits/i.test(errorMessage) ? "rate_limited" : turn?.status === "interrupted" ? "cancelled" : "cli_error";
        finish({ ok: false, errorClass, errorMessage: errorMessage.slice(0, 2000) });
      }
    }
  });
  try {
    if (options.signal?.aborted) return { ok: false, errorClass: "cancelled", errorMessage: "Your Vantage request was cancelled." };
    const execute = async () => {
      await rpc.request("initialize", { clientInfo: { name: "vantage_personal_bridge", title: "Vantage personal connection", version: "0.2.0" }, capabilities: { experimentalApi: true } });
      rpc.notify("initialized", {});
      const account = await rpc.request("account/read", { refreshToken: false });
      if ((account.account as { type?: string } | null)?.type !== "chatgpt") return finish({ ok: false, errorClass: "not_authenticated", errorMessage: "Sign in to your own ChatGPT account in this Vantage profile using codex login." });
      if (options.testOnly) return finish({ ok: true, text: "Your personal Codex account is connected.", model: null, usage: { inputTokens: 0, outputTokens: 0 } });
      if (finished) return;
      const started = await rpc.request("thread/start", {
        cwd: options.cwd, ephemeral: true, approvalPolicy: "on-request", sandbox: "read-only", serviceName: "vantage",
        config: { "features.shell_tool": false, "features.multi_agent": false, "features.remote_plugin": false, web_search: "disabled" },
        dynamicTools: options.tools?.list().map((tool) => ({ type: "function", name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) ?? [],
        baseInstructions: "Answer the submitted Vantage request using its supplied context and authorized Vantage feature tools. Write tools return proposals; the person must confirm them in Vantage. Never claim a proposed action is completed. Do not inspect local files, credentials, or unrelated conversations. Do not run shell commands or change files.",
      });
      threadId = (started.thread as { id?: string })?.id ?? null;
      model = typeof started.model === "string" ? started.model : null;
      if (!threadId) throw new Error("Codex did not return a new thread.");
      if (finished) return;
      const startedTurn = await rpc.request("turn/start", { threadId, input: [{ type: "text", text: options.prompt, text_elements: [] }], sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request" });
      const returnedId = (startedTurn.turn as { id?: string })?.id;
      if (!returnedId || (turnId && turnId !== returnedId)) throw new Error("Codex returned an inconsistent turn identity.");
      turnId = returnedId;
      if (finished) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    };
    void execute().catch((error: unknown) => finish({ ok: false, errorClass: "cli_error", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "The Codex connection failed." }));
    return await outcome;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    unsubscribe();
    rpc.close();
  }
}
