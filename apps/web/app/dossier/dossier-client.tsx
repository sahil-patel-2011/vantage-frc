"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import type { DossierView } from "../../lib/dossier/compute-dossier";

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identity",
  season_epa: "Season EPA",
  event: "Event metrics",
  record: "Event record",
  scout: "Org scout",
};

export default function DossierClient() {
  const [view, setView] = useState<DossierView | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);

  const orgId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("orgId");
  }, []);

  const load = useCallback(
    (team?: string) => {
      setFetchFailed(false);
      setError("");
      const params = new URLSearchParams();
      if (orgId) params.set("orgId", orgId);
      const teamValue = team ?? new URLSearchParams(window.location.search).get("team");
      if (teamValue) params.set("team", teamValue);
      void fetch(`/api/dossier?${params.toString()}`)
        .then(async (response) => {
          const data = (await response.json()) as DossierView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Could not load dossier");
            setFetchFailed(true);
            return;
          }
          setView(data);
        })
        .catch(() => setFetchFailed(true));
    },
    [orgId],
  );

  useEffect(() => {
    load();
  }, [load]);

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Enter a numeric FRC team number");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("team", trimmed);
    if (orgId) url.searchParams.set("orgId", orgId);
    window.history.replaceState({}, "", url.toString());
    load(trimmed);
  }

  return (
    <main className="module-page dossier-page">
      <PageHeader
        breadcrumbs="Competition / Dossier"
        title="Season team dossier"
        description="Fact cards only — TBA identity, Statbotics/TBA EPA and records, and org scout notes. Every card carries a citation. Nothing is invented when the cache is empty."
      >
        {view?.status === "live" ? (
          <span className="app-badge good">Cited facts</span>
        ) : view?.status === "empty" ? (
          <span className="app-badge setup">No facts yet</span>
        ) : view?.status === "setup_required" ? (
          <span className="app-badge setup">Setup required</span>
        ) : null}
      </PageHeader>

      <Panel as="form" className="dossier-search-panel" onSubmit={onSearch} style={{ minHeight: "auto" }}>
        <FormRow
          label="Team number"
          hint={
            <>
              <a href={orgId ? `/intel?orgId=${encodeURIComponent(orgId)}` : "/intel"}>Intel</a>
              {" · "}
              <a href={orgId ? `/strategy?orgId=${encodeURIComponent(orgId)}` : "/strategy"}>Strategy</a>
            </>
          }
        >
          <div className="dossier-search-row">
            <input
              id="dossier-team"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                view && "teamNumber" in view && view.teamNumber ? String(view.teamNumber) : "e.g. 2337"
              }
              inputMode="numeric"
            />
            <button type="submit" className="app-button">
              Load dossier
            </button>
          </div>
        </FormRow>
      </Panel>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load dossier" description="Retry when the network is available.">
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading dossier…" description="Checking workspace and reference caches." aria-busy />
      ) : view.status === "live" ? (
        <LiveDossier view={view} />
      ) : (
        <EmptyState
          badge={view.status === "empty" ? "No facts yet" : "Setup required"}
          badgeTone="setup"
          title={view.message}
        >
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id} className={step.done ? "done" : undefined}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                {step.done ? <em>Done</em> : <a href={step.href}>Open</a>}
              </li>
            ))}
          </ol>
          {!view.referenceAccess.statbotics.cacheHasMetrics ? (
            <p className="app-muted">
              Statbotics cache: empty ({view.referenceAccess.statbotics.eventMetricRows} event /{" "}
              {view.referenceAccess.statbotics.yearMetricRows} year rows). Public API — no key required.
            </p>
          ) : null}
        </EmptyState>
      )}
    </main>
  );
}

function LiveDossier({ view }: { view: Extract<DossierView, { status: "live" }> }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof view.cards>();
    for (const card of view.cards) {
      const list = map.get(card.category) ?? [];
      list.push(card);
      map.set(card.category, list);
    }
    return [...map.entries()];
  }, [view.cards]);

  return (
    <section className="dossier-live" aria-label="Season dossier facts">
      <Panel className="dossier-hero-card" style={{ minHeight: "auto" }}>
        <header className="dossier-hero">
          <div>
            <span className="app-badge">Team {view.teamNumber}</span>
            <h2>{view.nickname ?? view.name ?? view.teamKey}</h2>
            <p className="app-muted">
              {view.cards.length} cited fact cards · updated {new Date(view.computedAt).toLocaleString()}
            </p>
          </div>
          <div className="strategy-provenance">
            <span className="app-badge">
              Statbotics {view.referenceAccess.statbotics.cacheHasMetrics ? "cached" : "empty"}
            </span>
            <span className="app-badge">{view.referenceAccess.tbaConfigured ? "TBA ready" : "TBA missing"}</span>
          </div>
        </header>
      </Panel>
      {groups.map(([category, cards]) => (
        <section key={category} className="dossier-group" aria-label={CATEGORY_LABEL[category] ?? category}>
          <h3>{CATEGORY_LABEL[category] ?? category}</h3>
          <ul className="dossier-fact-grid">
            {cards.map((card) => (
              <li key={card.id} className="dossier-fact-card soft-panel">
                <span className="app-badge">{card.citation.source}</span>
                <strong>{card.title}</strong>
                <p>{card.value}</p>
                <small className="app-muted">
                  {card.citation.detail}
                  {card.citation.syncedAt
                    ? ` · synced ${new Date(card.citation.syncedAt).toLocaleDateString()}`
                    : ""}
                  {card.citation.eventKey ? ` · ${card.citation.eventKey}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
