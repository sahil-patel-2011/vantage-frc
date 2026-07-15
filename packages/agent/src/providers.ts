import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blockedIp(address: string) {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.includes(":")) return address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd") || address.toLowerCase().startsWith("fe80");
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function validateHostedProviderUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Hosted provider URLs must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in provider URLs");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
    throw new Error("Local providers require the Vantage local relay");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address)))
    throw new Error("Private, metadata, and local-network provider targets are blocked");
  return url.toString().replace(/\/$/, "");
}

export type LocalRelayRequest = {
  jobId: string;
  operation: "invoke_llm";
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
};
export type LocalRelayResponse = {
  jobId: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  providerModel: string;
};

export interface Base44Transport {
  invoke(config: { endpoint: string; workspaceId: string; credential: string }, payload: unknown): Promise<{
    content: string;
    promptTokens?: number;
    completionTokens?: number;
    providerModel?: string;
  }>;
}

export class Base44WorkspaceConnector {
  constructor(
    private readonly config: {
      endpoint?: string;
      workspaceId?: string;
      credential?: string;
      enabled: boolean;
      meteringMode: "verified" | "unverified";
    },
    private readonly transport?: Base44Transport,
  ) {}
  async invoke(payload: unknown) {
    if (!this.config.enabled || !this.config.endpoint || !this.config.workspaceId || !this.config.credential)
      throw new Error("Base44 connector is disabled until documented configuration is supplied");
    if (this.config.meteringMode !== "verified")
      throw new Error("Base44 managed billing requires connector-reported metering");
    if (!this.transport) throw new Error("No documented Base44 transport is configured");
    const result = await this.transport.invoke(
      {
        endpoint: await validateHostedProviderUrl(this.config.endpoint),
        workspaceId: this.config.workspaceId,
        credential: this.config.credential,
      },
      payload,
    );
    if (result.promptTokens == null || result.completionTokens == null)
      throw new Error("Connector did not return billable token usage");
    return result;
  }
}
