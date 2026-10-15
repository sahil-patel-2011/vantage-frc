"use client";

import { anySignal } from "../lib/abort/any-signal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchCommands, type CommandEntry, type CommandHit } from "../lib/nav/command-search";
import { listRecentCommands, rememberRecentCommand } from "../lib/nav/recent-commands";
import { withOrgHref } from "../lib/nav/product-nav";
import { isCurrentDestination } from "../lib/nav/current-destination";
import { loadRoster, searchRosterOffline, type OfflineRosterTeam } from "../lib/intel/offline-teams";
import { navResultRows, type NavResultRow, type SearchHit } from "./app-shell-model";

/**
 * One search, used by the phone menu's field and by the search palette (⌘K / Ctrl+K and the
 * top bar's "Search anything"). Pages and tools come from the command catalog as you type;
 * matching team data comes from /api/search a moment later. With `suggestWhenEmpty`, an empty
 * field lists recent places, then a few suggestions.
 */
export function useShellSearch({
  active,
  orgId,
  catalog,
  isAllowed,
  canManageTeam,
  navigate,
  onDone,
  suggestWhenEmpty = false,
}: {
  active: boolean;
  orgId: string;
  catalog: CommandEntry[];
  isAllowed: (href: string) => boolean;
  canManageTeam: boolean;
  navigate: (href: string) => void;
  /** Close the surface the search lives in. */
  onDone: () => void;
  suggestWhenEmpty?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [roster, setRoster] = useState<{ orgId: string; teams: OfflineRosterTeam[] } | null>(null);
  const [searchError, setSearchError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (!active || !orgId) return;
    let cancelled = false;
    void loadRoster(orgId).then(saved => {
      if (!cancelled && saved) setRoster({ orgId, teams: saved.roster });
    });
    return () => { cancelled = true; };
  }, [active, orgId]);

  // Every opening starts clean, with this device's recent places.
  useEffect(() => {
    if (active) {
      setRecentHrefs(listRecentCommands());
      return;
    }
    requestId.current += 1;
    setQuery("");
    setSearchHits([]);
    setSearchLoading(false);
    setSearchError("");
    setCursor(0);
  }, [active]);

  const queryActive = query.trim().length > 0;

  useEffect(() => {
    if (!active) return;
    const q = query.trim();
    if (q.length < 2) {
      requestId.current += 1;
      setSearchHits([]);
      setSearchLoading(false);
      setSearchError("");
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    setSearchHits([]);
    setSearchError("");
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (orgId) params.set("orgId", orgId);
      void fetch(`/api/search?${params.toString()}`, { cache: "no-store", signal: anySignal([controller.signal, AbortSignal.timeout(5_000)]) })
        .then(async (response) =>
          response.ok ? ((await response.json()) as { status?: string; results?: SearchHit[]; message?: string }) : Promise.reject(new Error("Search unavailable")),
        )
        .then((data) => {
          if (id !== requestId.current) return;
          if (data?.status !== "ready") setSearchError(data?.message ?? "Live team search is unavailable. Try again shortly.");
          const rows = data?.status === "ready" && Array.isArray(data.results) ? data.results.slice(0, 8) : [];
          setSearchHits(rows.map((row) => ({ title: row.title, subtitle: row.subtitle, href: row.href, sourceLabel: row.sourceLabel })));
          setSearchLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setSearchHits([]);
          setSearchLoading(false);
          setSearchError("Live search couldn't respond. You can still open a page or a saved team below.");
        });
    }, 220);
    // A superseded or closed search must not leave "Searching your team's data…" behind: the
    // aborted request returns early (its id is stale), so clear the flag here; a newer search
    // sets it again.
    return () => { window.clearTimeout(timer); controller.abort(); requestId.current += 1; setSearchLoading(false); };
  }, [active, query, orgId]);

  const commandHits = useMemo<CommandHit[]>(
    () =>
      active && (queryActive || suggestWhenEmpty)
        ? searchCommands(query, catalog, {
            limit: queryActive ? 8 : 4,
            isAllowed,
            recentHrefs,
            canManageTeam,
          // Never suggest the page you are on: choosing it only reloaded it.
          }).filter((hit) => typeof window === "undefined" || !isCurrentDestination(hit.href, window.location))
        : [],
    [active, canManageTeam, catalog, isAllowed, query, queryActive, recentHrefs, suggestWhenEmpty],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const localHits = useMemo<SearchHit[]>(() => !queryActive || !orgId ? [] :
    searchRosterOffline(roster?.orgId === orgId ? roster.teams : [], query).slice(0, 8).map(team => ({
      title: `Team ${team.teamNumber}`, subtitle: team.nickname, sourceLabel: "Saved event roster",
      href: `/competition?tab=teams&sub=lookup&team=${team.teamNumber}&orgId=${encodeURIComponent(orgId)}`,
    })), [orgId, query, queryActive, roster]);
  const mergedHits = useMemo(() => [...localHits, ...searchHits].filter((hit, index, all) =>
    isAllowed(hit.href) && all.findIndex(other => other.href === hit.href) === index), [localHits, searchHits, isAllowed]);
  const rows: NavResultRow[] = useMemo(() => navResultRows(commandHits, queryActive ? mergedHits : []),
    [commandHits, queryActive, mergedHits]);
  const activeIndex = rows.length ? Math.min(cursor, rows.length - 1) : -1;

  const openFullSearch = useCallback(() => {
    const q = query.trim();
    const href = withOrgHref(q ? `/search?q=${encodeURIComponent(q)}` : "/search", orgId || null);
    onDone();
    navigate(href);
  }, [navigate, onDone, orgId, query]);

  const goToCommand = useCallback(
    (hit: { href: string }) => {
      onDone();
      setRecentHrefs(rememberRecentCommand(hit.href));
      navigate(withOrgHref(hit.href, orgId || null));
    },
    [navigate, onDone, orgId],
  );

  const openRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) {
        openFullSearch();
        return;
      }
      if (row.kind === "command") {
        goToCommand(row.hit);
        return;
      }
      onDone();
      setRecentHrefs(rememberRecentCommand(row.href));
      navigate(row.href);
    },
    [goToCommand, navigate, onDone, openFullSearch, rows],
  );

  const openActive = useCallback(() => {
    if (activeIndex < 0) {
      if (queryActive) openFullSearch();
      return;
    }
    openRow(activeIndex);
  }, [activeIndex, openFullSearch, openRow, queryActive]);

  /** Arrow keys move through the results; Enter opens one; ⌘/Ctrl+Enter opens full search. */
  const onFieldKeyDown = useCallback(
    (event: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) => {
      if (!queryActive && (event.metaKey || event.ctrlKey) && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        if (rows[Number(event.key) - 1]) openRow(Number(event.key) - 1);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!rows.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCursor((current) => (Math.min(current, rows.length - 1) + step + rows.length) % rows.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          openFullSearch();
          return;
        }
        openActive();
      }
    },
    [openActive, openFullSearch, openRow, queryActive, rows],
  );

  return {
    query,
    setQuery,
    queryActive,
    commandHits,
    searchHits: queryActive ? mergedHits : [],
    searchLoading: queryActive && searchLoading,
    searchError: queryActive ? searchError : "",
    rows,
    activeIndex,
    setCursor,
    goToCommand,
    openRow,
    openFullSearch,
    onFieldKeyDown,
  };
}

export type ShellSearch = ReturnType<typeof useShellSearch>;
