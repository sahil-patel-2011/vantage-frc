"use client";

import { useEffect, useState } from "react";
import type { MyDayView } from "../../lib/my-day";

/**
 * Our matches still ahead, as chips: Strategy opened on one match with no way to look at the
 * next. Each chip is a link to this page with that match, which Strategy follows without a
 * reload. Only real scheduled matches from My Day's own list; nothing when there is none.
 */
export function StrategyMatchPicker({ orgId, current }: { orgId: string | null; current: string }) {
  const [matches, setMatches] = useState<Array<{ matchKey: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/my-day${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<MyDayView>) : null))
      .then((view) => {
        if (cancelled || !view || view.status !== "ready") return;
        const start = view.matches.findIndex((match) => match.isNext);
        const ahead = start < 0 ? [] : view.matches.slice(start).filter((match) => !match.scored);
        setMatches(ahead.slice(0, 6).map((match) => ({ matchKey: match.matchKey, label: match.matchLabel })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (matches.length < 2) return null;
  const href = (matchKey: string) => {
    const params = new URLSearchParams({ tab: "strategy", matchKey });
    if (orgId) params.set("orgId", orgId);
    return `/competition?${params.toString()}`;
  };
  return (
    <nav className="strategy-match-picker" aria-label="Our matches ahead">
      {matches.map((match) => (
        <a key={match.matchKey} href={href(match.matchKey)} aria-current={match.matchKey === current ? "page" : undefined}>
          {match.label}
        </a>
      ))}
    </nav>
  );
}
