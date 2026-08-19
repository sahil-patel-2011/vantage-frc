import type { SearchResult, SummaryProvider, WebSearchProvider } from "./types";

export class FixtureSearchProvider implements WebSearchProvider {
  readonly name = "local-fixture";
  constructor(private readonly fixtures: Record<string, SearchResult[]> = {}) {}
  async search(query: string, options: { limit: number }) {
    const key = Object.keys(this.fixtures).find((candidate) =>
      query.toLowerCase().includes(candidate.toLowerCase()),
    );
    return (key ? (this.fixtures[key] ?? []) : []).slice(0, options.limit);
  }
}

export class HttpJsonSearchProvider implements WebSearchProvider {
  readonly name: string;
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    name = "http-search",
  ) {
    this.name = name;
  }
  async search(query: string, options: { limit: number; signal?: AbortSignal }) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, limit: options.limit }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Search provider returned ${response.status}`);
    const payload = (await response.json()) as { results?: SearchResult[] };
    return (payload.results ?? []).slice(0, options.limit);
  }
}

export class LocalSummaryProvider implements SummaryProvider {
  readonly name = "local-deterministic";
  async summarize(input: Parameters<SummaryProvider["summarize"]>[0]) {
    const current = input.metrics.find((metric) => metric.epaTotal !== null);
    const sources = input.findings
      .filter((finding) => finding.confidence >= 0.6)
      .slice(0, 2)
      .map((finding) => finding.summary);
    const text = [
      `Team ${input.teamNumber}${input.nickname ? ` (${input.nickname})` : ""}`,
      current?.epaTotal == null
        ? "does not yet have enough verified performance data for an EPA assessment."
        : `currently measures ${current.epaTotal.toFixed(1)} EPA from ${current.source}.`,
      input.scoutObservations.length
        ? `${input.scoutObservations.length} organization scouting observations add event-specific context.`
        : "No organization scouting observations are available.",
      sources.length
        ? `Qualitative reports (verify at the linked sources): ${sources.join(" ")}`
        : "No sufficiently confident web research is available.",
    ].join(" ");
    return {
      text,
      promptTokens: 120 + input.findings.length * 20,
      completionTokens: Math.ceil(text.length / 4),
      costUsd: 0,
      model: "vantage-local-summary-v1",
    };
  }
}

export function isLiveResearchSearchConfigured() {
  return Boolean(process.env.RESEARCH_SEARCH_ENDPOINT?.trim() && process.env.RESEARCH_SEARCH_API_KEY?.trim());
}

export function createSearchProvider(): WebSearchProvider {
  const endpoint = process.env.RESEARCH_SEARCH_ENDPOINT?.trim();
  const apiKey = process.env.RESEARCH_SEARCH_API_KEY?.trim();
  if (endpoint && apiKey) return new HttpJsonSearchProvider(endpoint, apiKey);
  return new FixtureSearchProvider();
}
