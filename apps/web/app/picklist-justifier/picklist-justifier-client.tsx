"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { PicklistJustifierView } from "../../lib/picklist-justifier/compute-picklist-justifier";
import { picklistTierLabel } from "../../lib/picklist-justifier";

type LiveView = Extract<PicklistJustifierView, { status: "live" }>;

export default function PicklistJustifierClient() {
  const [view, setView] = useState<PicklistJustifierView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((pickListIdOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (pickListIdOverride) query.set("pickListId", pickListIdOverride);
    void fetch(`/api/picklist-justifier${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
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
        const response = await fetch("/api/picklist-justifier", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/strategy?orgId=${encodeURIComponent(orgId)}` : "/strategy"}>Competition</a>
            {" / Pick-list Justifier"}
          </>
        }
        title="Pick-list Auto-Justifier"
        description="Source-cited rationale for every pick-list slot, and a contradiction guard that flags picks leaning on scouting your own TBA match record disagrees with."
      >
        {view?.status === "live" && view.pickLists.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Pick list
            <select
              value={view.selectedPickListId ?? ""}
              onChange={(event) => load(event.target.value)}
            >
              {view.pickLists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name} ({pl.eventKey}) · {pl.entryCount} teams
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the pick-list justifier"
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
          <SummaryPanel view={view} busy={busy} mutate={mutate} />
          <EntriesList view={view} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel aria-label="Pick-list justifier summary">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{view.eventKey ?? "No event"}</h2>
          <small className="app-muted">
            {view.entries.length} slot{view.entries.length === 1 ? "" : "s"}
            {view.contradictionCount > 0 ? (
              <span className="app-badge demo" style={{ marginLeft: 8 }}>
                {view.contradictionCount} contradiction{view.contradictionCount === 1 ? "" : "s"} flagged
              </span>
            ) : null}
          </small>
        </div>
        <button
          type="button"
          className="app-button"
          disabled={busy || !view.selectedPickListId}
          onClick={() => view.selectedPickListId && mutate({ action: "generate", pickListId: view.selectedPickListId })}
        >
          {busy ? "Generating…" : "Generate justifications"}
        </button>
      </header>
    </Panel>
  );
}

function EntriesList({ view }: { view: LiveView }) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="No slots yet"
        badgeTone="setup"
        title="This pick list has no ranked teams"
        description="Add teams to the pick list under Competition, then come back to generate justifications."
      />
    );
  }
  return (
    <Panel>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.entries.map((entry) => (
          <li key={entry.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
              <div>
                <strong>
                  #{entry.rank} · {entry.teamNumber ? `Team ${entry.teamNumber}` : entry.teamKey}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {picklistTierLabel(entry.tier)}
                  {entry.notes ? ` · ${entry.notes}` : ""}
                </small>
              </div>
              {entry.contradiction?.flagged ? (
                <span className="app-badge demo">Contradiction flagged</span>
              ) : entry.rationale ? (
                <span className="app-badge good">Justified</span>
              ) : (
                <span className="app-badge setup">Not generated yet</span>
              )}
            </div>

            {entry.rationale ? (
              <p style={{ margin: 0 }}>{entry.rationale}</p>
            ) : (
              <p className="app-muted" style={{ margin: 0 }}>
                No rationale generated yet. {entry.tbaAvailable ? "TBA data is available." : "No TBA data yet for this team at this event."}{" "}
                {entry.scoutEntryCount > 0
                  ? `${entry.scoutEntryCount} scout entr${entry.scoutEntryCount === 1 ? "y" : "ies"} logged.`
                  : "No scouting logged yet."}
              </p>
            )}

            {entry.contradiction?.flagged && entry.contradiction.reason ? (
              <p className="telemetry-status" role="alert" style={{ margin: 0 }}>
                {entry.contradiction.reason}
              </p>
            ) : null}

            {entry.sources.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {entry.sources.map((source, index) => (
                  <li key={`${entry.id}-${index}`}>
                    <small className="app-muted">
                      <strong>{source.label}</strong>: {source.detail}
                    </small>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
