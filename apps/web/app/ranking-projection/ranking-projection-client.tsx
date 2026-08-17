"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { RankingProjectionView } from "../../lib/ranking-projection/compute-ranking-projection";
import { withOrgHref } from "../../lib/nav/product-nav";

export default function RankingProjectionClient() {
  const [view, setView] = useState<RankingProjectionView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/ranking-projection${query}`)
      .then(async (response) => {
        const data = (await response.json()) as RankingProjectionView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("Could not load ranking projection.");
          return;
        }
        setView(data);
      })
      .catch(() => setError("Network error — please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Ranking projection"}
          </>
        }
        title="Ranking projection"
        description="Current TBA rank plus remaining qualification matches from the cache — never a invented future rank."
      />
      {error ? <p className="app-muted">{error}</p> : null}
      {!view ? <p className="app-muted">Loading…</p> : null}
      {view?.status === "setup_required" ? (
        <EmptyState title="Rankings are not ready" description={view.message} />
      ) : null}
      {view?.status === "live" ? (
        <Panel>
          <p>
            {view.eventName} · rank {view.currentRank} · {view.record ?? "no record yet"}
          </p>
          <p>
            {view.playedQuals} quals played, {view.remainingQuals} remaining
            {view.epaTotal != null ? ` · EPA ${view.epaTotal}` : ""}
          </p>
          <p>
            <a className="app-button secondary" href={withOrgHref("/rankings", view.orgId)}>
              Open Rankings
            </a>
          </p>
        </Panel>
      ) : null}
    </main>
  );
}
