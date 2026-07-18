"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { distinctValues, scoutDisagreementStatusLabel } from "../../lib/scout-disagreements";
import { type ScoutDisagreementsView } from "../../lib/scout-disagreements/compute-scout-disagreements";
import type { ScoutDisagreement } from "../../lib/scout-disagreements/types";

function statusTone(status: ScoutDisagreement["status"]): string {
  if (status === "resolved") return "good";
  if (status === "dismissed") return "demo";
  return "setup";
}

type LiveView = Extract<ScoutDisagreementsView, { status: "live" }>;

export default function ScoutDisagreementsClient() {
  const [view, setView] = useState<ScoutDisagreementsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

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
    void fetch(`/api/scout-disagreements${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutDisagreementsView | { error?: string };
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
        const response = await fetch("/api/scout-disagreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ScoutDisagreementsView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Disagreements"}
          </>
        }
        title="Scout Disagreements"
        description="Resolve conflicting scouted field values between scouts, with an immutable audit trail for every decision."
      >
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Scout Disagreements"
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
          <SummaryTiles view={view} />
          <LogDisagreementForm busy={busy} mutate={mutate} />
          <Queue view={view} busy={busy} mutate={mutate} />
          <AuditLog view={view} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Open", value: String(summary.totalOpen) },
    { label: "Resolved", value: String(summary.totalResolved) },
    { label: "Dismissed", value: String(summary.totalDismissed) },
    { label: "Matches affected", value: String(summary.distinctMatches) },
    { label: "Fields affected", value: String(summary.distinctFields) },
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

function Queue({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.items.length === 0) {
    return (
      <EmptyState
        badge="No disagreements yet"
        badgeTone="setup"
        title="Log your first conflicting field"
        description="When two scouts report different values for the same match/team/field, log it here to build the resolution queue."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Resolution queue</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.items.map((item) => (
          <QueueRow key={item.id} item={item} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function QueueRow({
  item,
  busy,
  mutate,
}: {
  item: ScoutDisagreement;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const options = distinctValues(item.values);

  return (
    <li className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <span className={`app-badge ${statusTone(item.status)}`}>{scoutDisagreementStatusLabel(item.status)}</span>
          <strong style={{ display: "block", marginTop: 4 }}>
            Match {item.matchNumber} · Team {item.teamNumber} · {item.fieldLabel}
          </strong>
          <small className="app-muted">
            {item.values.map((value) => `${value.source}: ${value.value}`).join("  ·  ")}
          </small>
        </div>
      </header>

      {item.status === "resolved" ? (
        <small className="app-muted">
          Resolved to <strong>{item.resolvedValue}</strong>
          {item.resolutionNote ? ` — ${item.resolutionNote}` : ""}
        </small>
      ) : null}

      {item.status === "open" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={choice}
            aria-label="Authoritative value"
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose authoritative value…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            placeholder="Resolution note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button
            type="button"
            className="app-button"
            disabled={busy || !choice}
            onClick={() => {
              mutate({ action: "resolve", disagreementId: item.id, resolvedValue: choice, note: note || undefined });
              setChoice("");
              setNote("");
            }}
          >
            Resolve
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => mutate({ action: "dismiss", disagreementId: item.id, note: note || undefined })}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => mutate({ action: "reopen", disagreementId: item.id })}
          >
            Reopen
          </button>
        </div>
      )}
    </li>
  );
}

function AuditLog({ view }: { view: LiveView }) {
  if (view.auditLog.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Audit trail</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {view.auditLog.map((entry) => (
          <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>
              {entry.action}
              {entry.previousStatus && entry.newStatus ? ` (${entry.previousStatus} → ${entry.newStatus})` : ""}
              {entry.resolvedValue ? ` — ${entry.resolvedValue}` : ""}
              {entry.note ? ` — ${entry.note}` : ""}
            </span>
            <small className="app-muted">{new Date(entry.createdAt).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogDisagreementForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      matchNumber: "",
      teamNumber: "",
      fieldKey: "",
      fieldLabel: "",
      eventKey: "",
      sourceA: "",
      valueA: "",
      sourceB: "",
      valueB: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const canSubmit =
    form.matchNumber.trim() &&
    form.teamNumber.trim() &&
    form.fieldKey.trim() &&
    form.fieldLabel.trim() &&
    form.valueA.trim() &&
    form.valueB.trim();

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        mutate({
          action: "log-disagreement",
          matchNumber: Number(form.matchNumber),
          teamNumber: Number(form.teamNumber),
          fieldKey: form.fieldKey,
          fieldLabel: form.fieldLabel,
          eventKey: form.eventKey || undefined,
          values: [
            { source: form.sourceA || "Scout A", value: form.valueA },
            { source: form.sourceB || "Scout B", value: form.valueB },
          ],
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a disagreement</h2>
      <FormGrid min={160}>
        <FormRow label="Match #">
          <input type="number" min={1} value={form.matchNumber} onChange={set("matchNumber")} required />
        </FormRow>
        <FormRow label="Team #">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} required />
        </FormRow>
        <FormRow label="Field key">
          <input value={form.fieldKey} onChange={set("fieldKey")} placeholder="autoMobility" required />
        </FormRow>
        <FormRow label="Field label">
          <input value={form.fieldLabel} onChange={set("fieldLabel")} placeholder="Auto mobility" required />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
      </FormGrid>
      <FormGrid min={160}>
        <FormRow label="Scout A name">
          <input value={form.sourceA} onChange={set("sourceA")} placeholder="Scout A" />
        </FormRow>
        <FormRow label="Scout A value">
          <input value={form.valueA} onChange={set("valueA")} required />
        </FormRow>
        <FormRow label="Scout B name">
          <input value={form.sourceB} onChange={set("sourceB")} placeholder="Scout B" />
        </FormRow>
        <FormRow label="Scout B value">
          <input value={form.valueB} onChange={set("valueB")} required />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !canSubmit}>
          Log disagreement
        </button>
      </div>
    </Panel>
  );
}
