import { CLAUDE_CAD_TOOLS, callClaudeCadTool } from "./claude-cad";

const PROTOCOL_VERSION = "2024-11-05";

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

function writeFrame(message: unknown) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

export type CadMcpHooks = {
  /**
   * Observes every tools/call after it ran (ok=false carries the error text).
   * Used by the vantage-cad CLI to sync terminal sessions to the web app.
   * Must never throw and never write to stdout (stdout is MCP protocol).
   */
  onToolCall?: (name: string, args: Record<string, unknown>, ok: boolean, error?: string) => void | Promise<void>;
};

export async function dispatchCadMcp(message: JsonRpc, hooks: CadMcpHooks = {}): Promise<void> {
  const method = String(message.method ?? "");
  const id = message.id;
  if (method === "initialize") {
    writeFrame({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "vantage-cad", version: "0.1.1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    if (id !== undefined && id !== null) writeFrame({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    writeFrame({ jsonrpc: "2.0", id, result: { tools: CLAUDE_CAD_TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callClaudeCadTool(name, args);
      writeFrame({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, true)).catch(() => undefined);
    } catch (error) {
      const text = error instanceof Error ? error.message : "CAD tool failed";
      writeFrame({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }], isError: true },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, false, text)).catch(() => undefined);
    }
    return;
  }
  if (id !== undefined && id !== null) {
    writeFrame({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method ${method || "(none)"}` } });
  }
}

export async function runCadMcpStdio(hooks: CadMcpHooks = {}) {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const asText = buffer.toString("utf8");
        const nl = asText.indexOf("\n");
        if (nl !== -1 && asText.trimStart().startsWith("{")) {
          const line = asText.slice(0, nl).trim();
          buffer = Buffer.from(asText.slice(nl + 1), "utf8");
          try {
            void dispatchCadMcp(JSON.parse(line) as JsonRpc, hooks);
          } catch {
            /* ignore incomplete */
          }
          continue;
        }
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      try {
        void dispatchCadMcp(JSON.parse(body) as JsonRpc, hooks);
      } catch {
        /* ignore */
      }
    }
  });
}
