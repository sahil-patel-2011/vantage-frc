"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchCommands, type CommandEntry, type CommandHit } from "../lib/nav/command-search";
import { listRecentCommands, rememberRecentCommand } from "../lib/nav/recent-commands";
import { withOrgHref } from "../lib/nav/product-nav";
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
  const requestId = useRef(0);

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
      return;
    }
    const id = ++requestId.current;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (orgId) params.set("orgId", orgId);
      void fetch(`/api/search?${params.toString()}`, { cache: "no-store" })
        .then(async (response) =>
          response.ok ? ((await response.json()) as { status?: string; results?: SearchHit[] }) : null,
        )
        .then((data) => {
          if (id !== requestId.current) return;
          const rows = data?.status === "ready" && Array.isArray(data.results) ? data.results.slice(0, 8) : [];
          setSearchHits(rows.map((row) => ({ title: row.title, subtitle: row.subtitle, href: row.href, sourceLabel: row.sourceLabel })));
          setSearchLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setSearchHits([]);
          setSearchLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [active, query, orgId]);

  const commandHits = useMemo<CommandHit[]>(
    () =>
      active && (queryActive || suggestWhenEmpty)
        ? searchCommands(query, catalog, {
            limit: queryActive ? 8 : 7,
            isAllowed,
            recentHrefs,
            canManageTeam,
          })
        : [],
    [active, canManageTeam, catalog, isAllowed, query, queryActive, recentHrefs, suggestWhenEmpty],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const rows: NavResultRow[] = useMemo(
    () => navResultRows(commandHits, queryActive ? searchHits : []),
    [commandHits, queryActive, searchHits],
  );
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
    [openActive, openFullSearch, rows.length],
  );

  return {
    query,
    setQuery,
    queryActive,
    commandHits,
    searchHits: queryActive ? searchHits : [],
    searchLoading: queryActive && searchLoading,
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
