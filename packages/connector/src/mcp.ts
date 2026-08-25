import type {
  CapabilityContext,
  CapabilityDetection,
  CapabilityReport,
  ConnectorCapability,
} from "./capability.js";
import { CONNECTOR_VERSION } from "./version.js";

/**
 * mcp capability — expose Vantage as an MCP stdio server to Claude Code / Cursor on this
 * machine. The JSON-RPC framing and dispatch are a generalized port of the proven CAD-only
 * server in packages/cad/src/mcp-stdio.ts (which stays untouched): same Content-Length
 * framing with the line-delimited fallback, same method surface (initialize, ping,
 * tools/list, tools/call), but the TOOLS are an injected registry instead of a hard-coded
 * CAD list — the actual Vantage tool surface is wired by the hosts.
 *
 * Unlike the resident capabilities, an MCP server is launched ON DEMAND by the editor
 * (Claude Code / Cursor spawns the host command and speaks stdio). So the supervisor-run
 * capability below only reports availability honestly; `runConnectorMcp` is what a host
 * binds to its stdio when the editor launches it.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolRegistry = {
  list(): McpToolDefinition[];
  /** Throws (or rejects) with a human-readable message on tool failure. */
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
};

/** A registry with no tools — the honest default until the host wires the real surface. */
export function emptyToolRegistry(): McpToolRegistry {
  return {
    list: () => [],
    call: async (name: string) => {
      throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
    },
  };
}

/**
 * One genuinely local, self-contained tool: the live status of this connector (which
 * capabilities are enabled/running, what was detected). Hosts pass the supervisor's
 * status() so an editor session can ask "is the team bridge up?" without leaving chat.
 */
export function connectorStatusToolRegistry(getStatus: () => unknown): McpToolRegistry {
  const definition: McpToolDefinition = {
    name: "vantage_connector_status",
    description:
      "Live status of the Vantage connector on this machine: paired org, enabled capabilities, their run state, and last detection details.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  };
  return {
    list: () => [definition],
    call: async (name: string) => {
      if (name !== definition.name) {
        throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
      }
      return getStatus();
    },
  };
}

/** Merge registries (first match wins on duplicate tool names). */
export function combineToolRegistries(...registries: McpToolRegistry[]): McpToolRegistry {
  return {
    list: () => {
      const seen = new Set<string>();
      const out: McpToolDefinition[] = [];
      for (const registry of registries) {
        for (const tool of registry.list()) {
          if (seen.has(tool.name)) continue;
          seen.add(tool.name);
          out.push(tool);
        }
      }
      return out;
    },
    call: async (name, args) => {
      for (const registry of registries) {
        if (registry.list().some((tool) => tool.name === name)) return registry.call(name, args);
      }
      throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
    },
  };
}

/* ------------------------------------------------------------------ */
/* JSON-RPC dispatch + framing (port of packages/cad/src/mcp-stdio.ts) */
/* ------------------------------------------------------------------ */

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpWrite = (message: unknown) => void;

export type McpHooks = {
  /**
   * Observes every tools/call after it ran (ok=false carries the error text).
   * Must never throw and never write to stdout (stdout is MCP protocol).
   */
  onToolCall?: (name: string, args: Record<string, unknown>, ok: boolean, error?: string) => void | Promise<void>;
};

export async function dispatchConnectorMcp(
  message: JsonRpcMessage,
  registry: McpToolRegistry,
  write: McpWrite,
  hooks: McpHooks = {},
): Promise<void> {
  const method = String(message.method ?? "");
  const id = message.id;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "vantage-connector", version: CONNECTOR_VERSION },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    if (id !== undefined && id !== null) write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    write({ jsonrpc: "2.0", id, result: { tools: registry.list() } });
    return;
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await registry.call(name, args);
      write({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, true)).catch(() => undefined);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Connector tool failed";
      write({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }], isError: true },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, false, text)).catch(() => undefined);
    }
    return;
  }
  if (id !== undefined && id !== null) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method ${method || "(none)"}` } });
  }
}

/** Serialize a message as a Content-Length framed MCP frame. */
export function encodeMcpFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"), payload]);
}

/**
 * Incremental frame decoder: feed chunks, get parsed messages. Handles Content-Length
 * framing and the line-delimited JSON fallback some clients speak (same tolerance as
 * mcp-stdio.ts). Pure state machine — testable without streams.
 */
export class McpFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer | string): JsonRpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const asText = this.buffer.toString("utf8");
        const nl = asText.indexOf("\n");
        if (nl !== -1 && asText.trimStart().startsWith("{")) {
          const line = asText.slice(0, nl).trim();
          this.buffer = Buffer.from(asText.slice(nl + 1), "utf8");
          try {
            messages.push(JSON.parse(line) as JsonRpcMessage);
          } catch {
            /* ignore incomplete */
          }
          continue;
        }
        return messages;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return messages;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        messages.push(JSON.parse(body) as JsonRpcMessage);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Bind the MCP server to a pair of streams (a host wires process.stdin/stdout here when
 * the editor launches `<host> mcp`). Returns an unsubscribe function.
 */
export function runConnectorMcp(
  registry: McpToolRegistry,
  io: {
    input: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
    output: { write(chunk: Buffer): unknown };
  },
  hooks: McpHooks = {},
): void {
  const decoder = new McpFrameDecoder();
  const write: McpWrite = (message) => {
    io.output.write(encodeMcpFrame(message));
  };
  io.input.on("data", (chunk: Buffer) => {
    for (const message of decoder.push(chunk)) {
      void dispatchConnectorMcp(message, registry, write, hooks);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */

export class McpCapability implements ConnectorCapability {
  readonly id = "mcp" as const;
  readonly label = "MCP server (Claude Code / Cursor)";

  constructor(private readonly options: { registry?: McpToolRegistry } = {}) {}

  private registry(): McpToolRegistry {
    return this.options.registry ?? emptyToolRegistry();
  }

  async detect(): Promise<CapabilityDetection> {
    const tools = this.registry().list();
    return {
      available: true,
      detail:
        tools.length === 0
          ? "MCP stdio server is available; no Vantage tools are wired yet (the host provides the registry)."
          : `MCP stdio server with ${tools.length} tool(s), served on demand.`,
      data: { tools: tools.map((tool) => tool.name) },
    };
  }

  async start(ctx: CapabilityContext): Promise<void> {
    // Nothing resident to run: editors spawn the host's `mcp` command on demand and the
    // host calls runConnectorMcp with its stdio. This loop just holds the "enabled" state.
    while (!ctx.signal.aborted) {
      await ctx.clock.sleep(60_000, ctx.signal);
    }
  }

  async stop(): Promise<void> {
    // Nothing to release.
  }

  status(): CapabilityReport {
    const tools = this.registry().list();
    return {
      detail:
        "Served on demand over stdio when Claude Code / Cursor launches the connector's mcp command.",
      data: { tools: tools.map((tool) => tool.name) },
    };
  }
}
