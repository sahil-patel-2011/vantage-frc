import { readJson, UpstreamHttpError } from "./http";

const NEXUS_BASE = "https://frc.nexus/api/v1";

export type NexusLiveEvent = {
  eventKey: string;
  queuedMatchKey: string | null;
  nowQueuing: string | null;
  fetchedAt: string;
};

export type NexusPitAddresses = Record<string, string>;

export class NexusClient {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!options.apiKey.trim()) throw new Error("Nexus API key is required");
  }

  private async get<T>(resource: string): Promise<T> {
    const base = (this.options.baseUrl ?? NEXUS_BASE).replace(/\/$/, "");
    const path = resource.replace(/^\//, "");
    const response = await (this.options.fetch ?? fetch)(`${base}/${path}`, {
      headers: {
        "Nexus-Api-Key": this.options.apiKey,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new UpstreamHttpError("Nexus", response.status, path, null);
    }
    return (await readJson(response, "Nexus", path)) as T;
  }

  /** Live queue status. Empty/null fields stay null — never invent now-queuing. */
  async getLive(eventKey: string): Promise<unknown> {
    return this.get(`event/${encodeURIComponent(eventKey)}`);
  }

  async getPits(eventKey: string): Promise<NexusPitAddresses> {
    const body = await this.get<Record<string, string>>(`event/${encodeURIComponent(eventKey)}/pits`);
    return body && typeof body === "object" ? body : {};
  }
}

export function nexusAttributionHref(): string {
  return "https://frc.nexus";
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Map a Nexus live payload without inventing queue text. */
export function parseNexusLive(body: unknown, eventKey: string, fetchedAt: string): NexusLiveEvent {
  if (!body || typeof body !== "object") {
    return { eventKey, queuedMatchKey: null, nowQueuing: null, fetchedAt };
  }
  const record = body as Record<string, unknown>;
  return {
    eventKey,
    queuedMatchKey:
      asTrimmedString(record.queuedMatchKey) ??
      asTrimmedString(record.queued_match_key) ??
      asTrimmedString(record.matchKey) ??
      null,
    nowQueuing:
      asTrimmedString(record.nowQueuing) ??
      asTrimmedString(record.now_queuing) ??
      asTrimmedString(record.nowQueuingMatch) ??
      null,
    fetchedAt,
  };
}
