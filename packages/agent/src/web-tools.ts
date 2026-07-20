/**
 * Autonomous agent web tools: search + allowlisted fetch.
 * Soft-degrades to setup_required when no search key / browse disabled.
 */

import {
  isWebBrowseEnabled,
  safeAllowlistedFetch,
  WEB_EXCERPT_MAX_CHARS,
  type SafeFetchResult,
} from "./safe-web-fetch";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResult = {
  status: "ok" | "setup_required" | "empty" | "error";
  provider: string | null;
  message?: string;
  query: string;
  results: WebSearchHit[];
};

export type WebFetchToolResult = {
  status: "ok" | "setup_required" | "error";
  message?: string;
  url?: string;
  finalUrl?: string;
  excerpt?: string;
  truncated?: boolean;
  contentType?: string | null;
};

export type WebSearchEnv = {
  BRAVE_SEARCH_API_KEY?: string;
  RESEARCH_SEARCH_ENDPOINT?: string;
  RESEARCH_SEARCH_API_KEY?: string;
  AGENT_WEB_BROWSE_ENABLED?: string;
  [key: string]: string | undefined;
};

export function resolveWebSearchProvider(env: WebSearchEnv = process.env as WebSearchEnv): {
  kind: "brave" | "http_json" | null;
  label: string | null;
} {
  if (env.BRAVE_SEARCH_API_KEY?.trim()) {
    return { kind: "brave", label: "brave" };
  }
  if (env.RESEARCH_SEARCH_ENDPOINT?.trim() && env.RESEARCH_SEARCH_API_KEY?.trim()) {
    return { kind: "http_json", label: "research_http" };
  }
  return { kind: null, label: null };
}

function truncateSnippet(value: string, max = 400): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function searchBrave(
  query: string,
  limit: number,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<WebSearchHit[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(limit, 1), 10)));
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Brave search failed (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (payload.web?.results ?? [])
    .filter((row) => row.url && row.title)
    .slice(0, limit)
    .map((row) => ({
      title: String(row.title).slice(0, 200),
      url: String(row.url).slice(0, 2000),
      snippet: truncateSnippet(String(row.description ?? "")),
    }));
}

async function searchHttpJson(
  query: string,
  limit: number,
  endpoint: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<WebSearchHit[]> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, limit }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Search provider returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; snippet?: string; summary?: string }>;
  };
  return (payload.results ?? [])
    .filter((row) => row.url)
    .slice(0, limit)
    .map((row) => ({
      title: String(row.title ?? row.url).slice(0, 200),
      url: String(row.url).slice(0, 2000),
      snippet: truncateSnippet(String(row.snippet ?? row.summary ?? "")),
    }));
}

export async function executeWebSearch(
  input: { query: string; limit?: number },
  options: { env?: WebSearchEnv; fetchImpl?: typeof fetch } = {},
): Promise<WebSearchResult> {
  const query = String(input.query ?? "").trim().slice(0, 500);
  const limit = Math.min(Math.max(Number(input.limit ?? 5) || 5, 1), 10);
  if (!query) {
    return { status: "empty", provider: null, query: "", results: [], message: "query is required" };
  }
  const env = (options.env ?? process.env) as WebSearchEnv;
  const resolved = resolveWebSearchProvider(env);
  if (!resolved.kind) {
    return {
      status: "setup_required",
      provider: null,
      query,
      results: [],
      message:
        "No web search API key configured. Set BRAVE_SEARCH_API_KEY or RESEARCH_SEARCH_ENDPOINT + RESEARCH_SEARCH_API_KEY.",
    };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const results =
      resolved.kind === "brave"
        ? await searchBrave(query, limit, env.BRAVE_SEARCH_API_KEY!.trim(), fetchImpl)
        : await searchHttpJson(
            query,
            limit,
            env.RESEARCH_SEARCH_ENDPOINT!.trim(),
            env.RESEARCH_SEARCH_API_KEY!.trim(),
            fetchImpl,
          );
    if (!results.length) {
      return {
        status: "empty",
        provider: resolved.label,
        query,
        results: [],
        message: "Search returned no results.",
      };
    }
    return { status: "ok", provider: resolved.label, query, results };
  } catch (error) {
    return {
      status: "error",
      provider: resolved.label,
      query,
      results: [],
      message: error instanceof Error ? error.message : "Search failed",
    };
  }
}

export async function executeWebFetch(
  input: { url: string },
  options: { env?: WebSearchEnv; fetchImpl?: typeof fetch } = {},
): Promise<WebFetchToolResult> {
  const rawUrl = String(input.url ?? "").trim();
  if (!rawUrl) {
    return { status: "error", message: "url is required" };
  }
  const env = (options.env ?? process.env) as WebSearchEnv;
  if (!isWebBrowseEnabled(env as NodeJS.ProcessEnv)) {
    return {
      status: "setup_required",
      message: "Agent web browse is disabled. Set AGENT_WEB_BROWSE_ENABLED=true to enable allowlisted HTTPS fetch.",
    };
  }
  try {
    const fetched: SafeFetchResult = await safeAllowlistedFetch(rawUrl, {
      fetchImpl: options.fetchImpl,
      maxExcerptChars: WEB_EXCERPT_MAX_CHARS,
    });
    return {
      status: "ok",
      url: fetched.url,
      finalUrl: fetched.finalUrl,
      excerpt: fetched.excerpt,
      truncated: fetched.truncated,
      contentType: fetched.contentType,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    if (/setup_required/i.test(message)) {
      return { status: "setup_required", message };
    }
    return { status: "error", message, url: rawUrl };
  }
}
