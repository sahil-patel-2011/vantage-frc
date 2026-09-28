import type { McpToolDefinition, McpToolRegistry } from "./mcp.js";
import type { ConnectorConfig } from "./config.js";
import type { JsonHttpTransport } from "./ports.js";

type Field = { type: "string" | "number" | "integer"; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number };
type FeatureTool = McpToolDefinition & { service: string; mutation: boolean; inputSchema: { type: "object"; properties: Record<string, Field>; required: string[]; additionalProperties: false } };
const string = (maxLength: number, minLength = 0): Field => ({ type: "string", minLength, maxLength });
const season: Field = { type: "integer", minimum: 1992, maximum: 2100 };
const limit: Field = { type: "integer", minimum: 1, maximum: 20 };

function tool(service: string, description: string, properties: Record<string, Field>, required: string[] = [], mutation = false): FeatureTool {
  return {
    name: `vantage_${service.replaceAll(".", "_")}`,
    service, description, mutation,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: { readOnlyHint: !mutation, destructiveHint: false, idempotentHint: !mutation, openWorldHint: false },
  };
}

/** Explicit service allowlist. Identity, SQL, shell commands and credentials are never tool inputs. */
export const PERSONAL_FEATURE_TOOLS: readonly FeatureTool[] = [
  tool("scouting.team", "Read your team's observations and supporting match data for a robot.", { teamKey: { ...string(16, 4), pattern: "^frc[0-9]+$" } }, ["teamKey"]),
  tool("scouting.schema", "Read the configured scouting fields and units for a season.", { seasonYear: season }),
  tool("inventory.availability", "Search stock and BOM availability in your team.", { query: string(160), subsystem: string(120), limit: { ...limit, maximum: 40 } }),
  tool("knowledge.search", "Search your team's wiki and saved decisions.", { query: string(200, 1), limit }, ["query"]),
  tool("cad.briefs", "Read your team's recent CAD briefs and their actual job status.", { limit }),
  tool("my_day.summary", "Read your event context and next-match readiness.", {}),
  tool("finance.create_purchase_request", "Propose a purchase request. A person must confirm it in Vantage; this tool never places an order or spends money.", { title: string(200, 1), justification: string(2000, 1), quantity: { type: "integer", minimum: 1, maximum: 9999 }, estimateUsd: { type: "number", minimum: 0, maximum: 1_000_000 }, itemUrl: string(2000), vendor: string(120), seasonYear: season }, ["title", "justification"], true),
  tool("cad.create_brief", "Propose a CAD engineering brief. A person must confirm it in Vantage before a job is created.", { request: string(12000, 1), title: string(160), matchKey: string(80), seasonYear: season }, ["request"], true),
];

export function validateFeatureToolInput(name: string, value: unknown): { tool: FeatureTool; input: Record<string, unknown> } {
  const definition = PERSONAL_FEATURE_TOOLS.find((entry) => entry.name === name);
  if (!definition) throw new Error("This Vantage tool is not available.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of definition.inputSchema.required) if (!(key in input)) throw new Error(`${key} is required.`);
  for (const [key, fieldValue] of Object.entries(input)) {
    const field = definition.inputSchema.properties[key];
    if (!field) throw new Error(`Unsupported tool argument: ${key}.`);
    if (field.type === "string") {
      if (typeof fieldValue !== "string" || fieldValue.trim().length < (field.minLength ?? 0) || fieldValue.length > (field.maxLength ?? Infinity) || (field.pattern && !new RegExp(field.pattern).test(fieldValue))) throw new Error(`${key} is invalid.`);
    } else if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || (field.type === "integer" && !Number.isInteger(fieldValue)) || fieldValue < (field.minimum ?? -Infinity) || fieldValue > (field.maximum ?? Infinity)) throw new Error(`${key} is invalid.`);
  }
  return { tool: definition, input };
}

/** Reads the selected profile again for every call, so token revocation/re-pairing takes effect. */
export function personalFeatureToolRegistry(transport: JsonHttpTransport, loadConfig: () => Promise<ConnectorConfig | null>): McpToolRegistry {
  return {
    list: () => PERSONAL_FEATURE_TOOLS.map((entry) => ({ name: entry.name, description: entry.description, inputSchema: entry.inputSchema, annotations: entry.annotations })),
    async call(name, input) {
      validateFeatureToolInput(name, input);
      const config = await loadConfig();
      if (!config?.userId || !config.orgId) throw new Error("Pair your personal Vantage profile first.");
      const base = new URL(config.baseUrl);
      if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Vantage connections require HTTPS.");
      const response = await transport.postJson(new URL("/api/ai-bridge/device/tools", base).toString(), { name, input }, { token: config.deviceToken, timeoutMs: 30_000 });
      if (!response.ok) throw new Error(typeof response.data.error === "string" ? response.data.error : `Vantage tool failed (${response.status}).`);
      return response.data.result;
    },
  };
}
