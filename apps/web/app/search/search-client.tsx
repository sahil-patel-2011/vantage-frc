"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  TextBlockSkeleton,
  Toolbar,
  type BadgeTone,
} from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type {
  SearchResult,
  SearchSourceId,
  UnifiedSearchView,
} from "../../lib/search/unified-search";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; view: UnifiedSearchView }
  | { kind: "error"; message: string; status: number | null };

const SOURCE_TONE: Record<SearchSourceId, BadgeTone> = {
  help: "info",
  tasks: "info",
  inventory: "good",
  impact: "demo",
  knowledge: "neutral",
};

function readParams(): { q: string; orgId: string | null } {
  if (typeof window === "undefined") return { q: "", orgId: null };
  const params = new URLSearchParams(window.location.search);
  return { q: params.get("q") ?? "", orgId: params.get("orgId") };
}

/** Keep the URL query string in sync so a search is shareable / reloadable. */
function syncUrl(q: string, orgId: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (q) params.set("q", q);
  else params.delete("q");
  if (orgId) params.set("orgId", orgId);
  const next = params.toString();
  const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function isSearchView(value: unknown): value is UnifiedSearchView {
  if (!value || typeof value !== "object") return false;
  const status = (value as UnifiedSearchView).status;
  return status === "ready" || status === "setup_required";
}

async function persistSearchSnapshot(orgId: string, data: UnifiedSearchView): Promise<void> {
  if (data.status !== "ready") return;
  try {
    await putFeatureSnapshot("search", orgId, data);
  } catch {
    // Live search already painted; IndexedDB is best-effort.
  }
}

function ResultRow({ result }: { result: SearchResult }) {
  return (
    <li>
      <a
        href={result.href}
        style={{
          display: "block",
          textDecoration: "none",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Badge tone={SOURCE_TONE[result.source]}>{result.sourceLabel}</Badge>
          <strong>{result.title}</strong>
        </div>
        {result.subtitle ? (
          <span className="app-muted" style={{ display: "block", marginTop: "0.15rem" }}>
            {result.subtitle}
          </span>
        ) : null}
      </a>
    </li>
  );
}

export default function SearchClient() {
  const initial = useRef(readParams());
  const [term, setTerm] = useState(initial.current.q);
  const [orgId, setOrgId] = useState<string | null>(initial.current.orgId);
  const [activeSources, setActiveSources] = useState<Set<SearchSourceId>>(new Set());
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const paintedRef = useRef(false);

  const runSearch = useCallback((rawTerm: string, org: string | null) => {
    const q = rawTerm.trim();
    if (q.length < 2) {
      setState({ kind: "idle" });
      setFromCache(false);
      setCachedAt(null);
      paintedRef.current = false;
      return;
    }
    const id = ++requestId.current;
    const cacheOrg = org?.trim() || "_";
    void (async () => {
      let hadCache = paintedRef.current;
      try {
        const cached = await getFeatureSnapshot<UnifiedSearchView>("search", cacheOrg);
        if (id !== requestId.current) return;
        if (cached?.data && isSearchView(cached.data) && cached.data.status === "ready") {
          if (!paintedRef.current || cached.data.query === q) {
            setState({ kind: "loaded", view: cached.data });
            setFromCache(true);
            setCachedAt(cached.cachedAt);
            paintedRef.current = true;
            hadCache = true;
          }
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      if (!hadCache) setState({ kind: "loading" });
      try {
        const query = new URLSearchParams();
        query.set("q", q);
        if (org) query.set("orgId", org);
        const response = await fetch(`/api/search?${query.toString()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (id !== requestId.current) return;
        const errorMessage =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "";
        if (response.status === 401 || response.status === 403) {
          paintedRef.current = false;
          setFromCache(false);
          setCachedAt(null);
          setState({
            kind: "error",
            message: errorMessage || "Could not load search.",
            status: response.status,
          });
          return;
        }
        if (!response.ok || !isSearchView(data)) {
          if (hadCache || paintedRef.current) {
            setFromCache(true);
            return;
          }
          setState({
            kind: "error",
            message: errorMessage || "Search failed",
            status: response.status,
          });
          return;
        }
        if (data.status === "ready" && data.orgId) setOrgId(data.orgId);
        setState({ kind: "loaded", view: data });
        paintedRef.current = data.status === "ready";
        setFromCache(false);
        setCachedAt(null);
        if (data.status === "ready") {
          await persistSearchSnapshot(data.orgId || cacheOrg, data);
        }
      } catch {
        if (id !== requestId.current) return;
        if (hadCache || paintedRef.current) {
          setFromCache(true);
          return;
        }
        setState({
          kind: "error",
          message: "Could not reach search. Check your connection.",
          status: null,
        });
      }
    })();
  }, []);

  // Debounced search on term / org changes; also mirrors the URL.
  useEffect(() => {
    syncUrl(term, orgId);
    const handle = setTimeout(() => runSearch(term, orgId), 250);
    return () => clearTimeout(handle);
  }, [term, orgId, runSearch]);

  const view = state.kind === "loaded" ? state.view : null;
  const sources = view?.status === "ready" ? view.sources : [];

  const results = useMemo(() => {
    if (view?.status !== "ready") return [];
    if (activeSources.size === 0) return view.results;
    return view.results.filter((row) => activeSources.has(row.source));
  }, [view, activeSources]);

  const toggleSource = (id: SearchSourceId) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const failure =
    state.kind === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: state.status,
            message: state.message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: state.message,
          },
        )
      : null;

  return (
    <div className="app-page" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <PageHeader
        title="Search"
        description="One box across help tutorials, build tasks, inventory, community impact, and team knowledge."
      />
      <OfflineBanner fromCache={fromCache} cachedAt={cachedAt} feature="Search" />

      <Panel>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(term, orgId);
          }}
        >
          <label htmlFor="global-search-input" className="app-muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Search your team's data
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              id="global-search-input"
              type="search"
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search tasks, parts, outreach, wiki…"
              style={{ flex: "1 1 18rem", minWidth: 0 }}
              aria-describedby="global-search-hint"
            />
            <Button variant="primary" type="submit">
              Search
            </Button>
          </div>
          <span id="global-search-hint" className="app-muted" style={{ display: "block", marginTop: "0.35rem", fontSize: "0.85em" }}>
            Type at least 2 characters.
          </span>
        </form>

        {sources.length > 0 ? (
          <Toolbar aria-label="Filter results by source">
            {sources.map((source) => {
              const active = activeSources.has(source.id);
              return (
                <Button
                  key={source.id}
                  variant={active ? "primary" : "ghost"}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => toggleSource(source.id)}
                >
                  {source.label}
                </Button>
              );
            })}
            {activeSources.size > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setActiveSources(new Set())}>
                Clear filters
              </Button>
            ) : null}
          </Toolbar>
        ) : null}
      </Panel>

      {state.kind === "loading" ? (
        <Panel aria-busy>
          <TextBlockSkeleton />
        </Panel>
      ) : null}

      {failure ? (
        <EmptyState
          badge={failure.kind === "auth" ? "Signed out" : "Error"}
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" onClick={() => runSearch(term, orgId)}>
              Try again
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Setup"
          badgeTone="setup"
          title="Choose your team"
          description={view.message}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : null}

      {view?.status === "ready" && view.query && results.length === 0 ? (
        <EmptyState
          soft
          title={`No matches for “${view.query}”`}
          description="Try a shorter or different term, or clear source filters."
        />
      ) : null}

      {view?.status === "ready" && results.length > 0 ? (
        <Panel>
          <p className="app-muted" style={{ marginBottom: "0.5rem" }}>
            {results.length} result{results.length === 1 ? "" : "s"} for “{view.query}”
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}>
            {results.map((result) => (
              <ResultRow key={`${result.source}:${result.id}`} result={result} />
            ))}
          </ul>
        </Panel>
      ) : null}

      {state.kind === "idle" && !view ? (
        <EmptyState
          soft
          title="Start typing to search"
          description="Results span every team feature you have access to, ranked by recency."
        />
      ) : null}
    </div>
  );
}
