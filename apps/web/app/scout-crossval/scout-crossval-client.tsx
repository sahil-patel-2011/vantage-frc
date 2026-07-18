"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { crossvalStatusLabel } from "../../lib/scout-crossval";
import type { ScoutCrossvalView } from "../../lib/scout-crossval/compute-scout-crossval";
import type { CrossvalEntry, CrossvalStatus } from "../../lib/scout-crossval/types";

function statusTone(status: CrossvalStatus): string {
  if (status === "agree") return "good";
  if (status === "conflict") return "demo";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutCrossvalView, { status: "live" }>;

export default function ScoutCrossvalClient() {
  const [view, setView] = useState<ScoutCrossvalView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((eventOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const eventQuery = eventOverride ?? params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (eventQuery) query.set("eventKey", eventQuery);
    void fetch(`/api/scout-crossval${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutCrossvalView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if ("eventKey" in data) setEventKey(data.eventKey);
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
        const response = await fetch("/api/scout-crossval", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ScoutCrossvalView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if ("eventKey" in data) setEventKey(data.eventKey);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, eventKey, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Cross-Validation"}
          </>
        }
        title="Scout Cross-Validation"
        description="Compares saved match-scout entries against cached official (TBA) results and flags per-field agree, conflict, or unverifiable badges."
      >
        {view?.status === "live" && view.events.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Event
            <select
              value={eventKey ?? view.eventKey ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                setEventKey(next);
                load(next);
              }}
            >
              {view.events.map((key) => (
                <option key={key} value={key}>
                  {key}
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
          title="Could not load scout cross-validation"
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
          <SummaryPanel view={view} />
          <EntriesList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Scout entries", value: String(summary.totalEntries) },
    { label: "Agree", value: String(summary.agreeEntries) },
    { label: "Conflict", value: String(summary.conflictEntries) },
    { label: "Unverifiable", value: String(summary.unverifiableEntries) },
    { label: "Agreement rate", value: pct(summary.agreementRate) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EntriesList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="No scout entries yet"
        badgeTone="setup"
        title="No match-scout entries to cross-validate"
        description="Once scouts log match entries for this event, they'll appear here compared against cached official results."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Match entries</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.entries.map((entry) => (
          <EntryRow key={entry.matchScoutEntryId} entry={entry} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function EntryRow({
  entry,
  busy,
  mutate,
}: {
  entry: CrossvalEntry;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li style={{ display: "grid", gap: 6, borderTop: "1px solid var(--app-border, #2a2a33)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <strong>
            {entry.teamNumber != null ? `Team ${entry.teamNumber}` : entry.teamKey} · {entry.matchKey}
          </strong>
          <small className="app-muted" style={{ display: "block" }}>
            {entry.allianceColor ? `${entry.allianceColor} alliance` : "Alliance unknown"}
          </small>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`app-badge ${statusTone(entry.overallStatus)}`}>
            {crossvalStatusLabel(entry.overallStatus)}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => mutate({ action: "run-crossval", matchScoutEntryId: entry.matchScoutEntryId })}
          >
            Re-check
          </button>
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
        {entry.fields.map((field) => (
          <li
            key={field.fieldKey}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.9rem" }}
          >
            <span>{field.fieldLabel}</span>
            <span className="app-muted">
              {field.scoutValue ?? "—"} vs {field.officialValue ?? "—"}{" "}
              <span className={`app-badge ${statusTone(field.status)}`} style={{ marginLeft: 6 }}>
                {crossvalStatusLabel(field.status)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
