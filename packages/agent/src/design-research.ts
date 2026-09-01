/**
 * Research current FRC mechanical practice before CAD/design recommendations.
 * Uses the same web.search stack local models and Anthropic call — never guesses concepts.
 */

import { executeWebSearch, type WebSearchHit, type WebSearchResult } from "./web-tools";

const MECHANISM =
  /\b(intake|elevator|arm|wrist|climber|swerve|shooter|hood|turret|indexer|hopper|gearbox|drivetrain|pivot|four[- ]bar|cascade|telescope)\b/i;

export function extractMechanismTopic(text: string): string {
  const match = text.match(MECHANISM);
  return match?.[1]?.toLowerCase() ?? "mechanism";
}

export function buildDesignResearchQueries(topic: string, mechanism: string): string[] {
  const focus = topic.trim().slice(0, 180);
  const mech = mechanism.trim() || extractMechanismTopic(focus);
  return [
    `FRC ${mech} mechanical design ${new Date().getUTCFullYear()}`,
    `FRC ${mech} gearbox belt vs chain COTS`,
    `${focus} FRC CAD mechanical approach Chief Delphi`,
  ].slice(0, 3);
}

export type DesignResearchResult = {
  status: WebSearchResult["status"];
  provider: string | null;
  message?: string;
  topic: string;
  mechanism: string;
  queries: string[];
  results: WebSearchHit[];
  /** Phrases copied from snippets — not invented. */
  concepts: string[];
};

function conceptsFromHits(hits: WebSearchHit[]): string[] {
  const concepts: string[] = [];
  for (const hit of hits) {
    const snippet = hit.snippet.replace(/\s+/g, " ").trim();
    if (snippet.length >= 24) concepts.push(`${hit.title}: ${snippet.slice(0, 220)}`);
  }
  return concepts.slice(0, 8);
}

export async function executeDesignResearch(
  input: { topic: string; mechanism?: string; limit?: number },
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<DesignResearchResult> {
  const topic = String(input.topic ?? "").trim().slice(0, 400);
  const mechanism = String(input.mechanism ?? extractMechanismTopic(topic)).trim().slice(0, 40);
  if (!topic) {
    return {
      status: "empty",
      provider: null,
      topic: "",
      mechanism,
      queries: [],
      results: [],
      concepts: [],
      message: "topic is required",
    };
  }
  const queries = buildDesignResearchQueries(topic, mechanism);
  const merged: WebSearchHit[] = [];
  let provider: string | null = null;
  let setupMessage: string | undefined;
  let lastStatus: WebSearchResult["status"] = "empty";
  for (const query of queries) {
    const found = await executeWebSearch(
      { query, limit: input.limit ?? 5 },
      { env: options.env as never, fetchImpl: options.fetchImpl },
    );
    lastStatus = found.status;
    provider = found.provider ?? provider;
    if (found.status === "setup_required") {
      setupMessage = found.message;
      break;
    }
    for (const hit of found.results) {
      if (!merged.some((row) => row.url === hit.url)) merged.push(hit);
    }
  }
  if (setupMessage) {
    return {
      status: "setup_required",
      provider,
      topic,
      mechanism,
      queries,
      results: [],
      concepts: [],
      message: setupMessage,
    };
  }
  if (!merged.length) {
    return {
      status: lastStatus === "error" ? "error" : "empty",
      provider,
      topic,
      mechanism,
      queries,
      results: [],
      concepts: [],
      message: "No current mechanical-design sources found. Do not invent a mechanism.",
    };
  }
  return {
    status: "ok",
    provider,
    topic,
    mechanism,
    queries,
    results: merged.slice(0, 12),
    concepts: conceptsFromHits(merged),
  };
}
