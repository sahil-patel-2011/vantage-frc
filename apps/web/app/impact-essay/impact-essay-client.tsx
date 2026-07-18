"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { AWARD_LABEL, IMPACT_ESSAY_AWARDS, awardLabel } from "../../lib/impact-essay";
import type { ImpactEssayView } from "../../lib/impact-essay/compute-impact-essay";
import type { ImpactEssayAward } from "../../lib/impact-essay/types";

type LiveView = Extract<ImpactEssayView, { status: "live" }>;

export default function ImpactEssayClient() {
  const [view, setView] = useState<ImpactEssayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [award, setAward] = useState<ImpactEssayAward>("impact");

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/impact-essay${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ImpactEssayView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/impact-essay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ImpactEssayView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Impact Essay"}
          </>
        }
        title="FIRST Impact Essay Generator"
        description="Draft the Impact and Engineering Inspiration essays strictly from your logged outreach, hours, sponsors, and events — every claim cites a real record."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {orgId ? (
            <a className="app-button secondary" href={`/impact?orgId=${encodeURIComponent(orgId)}`}>
              Community Impact log
            </a>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the Impact essay generator"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <GroundedFactsPanel view={view} />
          <GenerateForm busy={busy} award={award} setAward={setAward} mutate={mutate} hasData={view.facts.hasGroundedData} />
          <DraftsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function GroundedFactsPanel({ view }: { view: LiveView }) {
  const { facts } = view;
  const tiles = [
    { label: "Outreach activities", value: String(facts.outreachActivities.length) },
    { label: "People reached", value: facts.totalPeopleReached.toLocaleString() },
    { label: "Outreach hours", value: String(facts.totalOutreachHours) },
    { label: "Build/shop hours", value: String(facts.buildHours.totalHours) },
    { label: "Active sponsors", value: String(facts.sponsors.length) },
    { label: "Team events", value: String(facts.events.length) },
  ];
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Grounded records — {view.seasonYear}</h2>
      {!facts.hasGroundedData ? (
        <p className="app-muted">
          No outreach activities, hours, sponsors, or team events are logged for this season yet. Log records
          elsewhere in Vantage, then generate a draft here — the essay will only ever cite real records.
        </p>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function GenerateForm({
  busy,
  award,
  setAward,
  mutate,
  hasData,
}: {
  busy: boolean;
  award: ImpactEssayAward;
  setAward: (award: ImpactEssayAward) => void;
  mutate: (payload: Record<string, unknown>) => void;
  hasData: boolean;
}) {
  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "generate-draft", award });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Generate a draft</h2>
      <label className="app-muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Award
        <select value={award} onChange={(event) => setAward(event.target.value as ImpactEssayAward)}>
          {IMPACT_ESSAY_AWARDS.map((value) => (
            <option key={value} value={value}>
              {AWARD_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="submit" className="app-button" disabled={busy || !hasData}>
          Generate essay draft
        </button>
        {!hasData ? (
          <span className="app-muted" style={{ marginLeft: 10 }}>
            Log at least one record to enable generation.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function DraftsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.drafts.length === 0) {
    return (
      <EmptyState
        badge="No drafts yet"
        badgeTone="setup"
        title="No essay drafts generated for this season"
        description="Generate a draft above once you have logged outreach, hours, sponsor, or event records."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Drafts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
        {view.drafts.map((draft) => (
          <li key={draft.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{awardLabel(draft.award)}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {draft.createdAt} · {draft.wordCount} words · {draft.citations.length} cited record(s)
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this draft?")) {
                    mutate({ action: "delete-draft", draftId: draft.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{draft.essayText}</p>
            {draft.citations.length > 0 ? (
              <div>
                <strong className="app-muted">Citations</strong>
                <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {draft.citations.map((citation, index) => (
                    <li key={`${draft.id}-${citation.id}-${index}`}>
                      <small className="app-muted">{citation.label}</small>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
