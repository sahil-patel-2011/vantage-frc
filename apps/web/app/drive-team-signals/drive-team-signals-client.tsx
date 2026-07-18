"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { SIGNAL_KINDS, SIGNAL_PRIORITIES, SIGNAL_ROLES, signalKindLabel, signalRoleLabel } from "../../lib/drive-team-signals";
import type { DriveTeamSignalsView } from "../../lib/drive-team-signals/compute-drive-team-signals";
import type {
  DriveTeamSignalSheet,
  SignalKind,
  SignalPriority,
  SignalRole,
} from "../../lib/drive-team-signals/types";

type LiveView = Extract<DriveTeamSignalsView, { status: "live" }>;

function priorityTone(priority: SignalPriority): string {
  if (priority === "critical") return "demo";
  if (priority === "important") return "setup";
  return "good";
}

export default function DriveTeamSignalsClient() {
  const [view, setView] = useState<DriveTeamSignalsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/drive-team-signals${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DriveTeamSignalsView | { error?: string };
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
        const response = await fetch("/api/drive-team-signals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as DriveTeamSignalsView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Drive-Team Signals"}
          </>
        }
        title="Drive-Team Signal Board"
        description="Build and share standardized driver/human-player comms cheat-sheets — hand signals, verbal callouts, radio codes, field markers — so the whole drive team speaks the same language."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the signal board"
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
          <CreateSheetForm busy={busy} mutate={mutate} />
          <SheetList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sheets", value: String(summary.totalSheets) },
    { label: "Signals", value: String(summary.totalSignals) },
    { label: "Critical", value: String(summary.criticalSignals) },
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

function CreateSheetForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ title: "", gameYear: "", eventKey: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-sheet",
          title: form.title,
          gameYear: form.gameYear ? Number(form.gameYear) : undefined,
          eventKey: form.eventKey || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>New signal sheet</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="2026 Reefscape signals" required />
        </FormRow>
        <FormRow label="Game year (optional)">
          <input type="number" min={2000} max={2999} value={form.gameYear} onChange={set("gameYear")} />
        </FormRow>
        <FormRow label="Event (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Create sheet
        </button>
      </div>
    </Panel>
  );
}

function SheetList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sheets.length === 0) {
    return (
      <EmptyState
        badge="No sheets yet"
        badgeTone="setup"
        title="Create your first signal sheet"
        description="Standardize the hand signals, callouts, and radio codes your drive team and human player use on the field."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {view.sheets.map((sheet) => (
        <SheetCard key={sheet.id} sheet={sheet} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function SheetCard({
  sheet,
  busy,
  mutate,
}: {
  sheet: DriveTeamSignalSheet;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{sheet.title}</h2>
          <small className="app-muted">
            {sheet.gameYear}
            {sheet.eventKey ? ` · ${sheet.eventKey}` : ""} · {sheet.signals.length} signal(s)
          </small>
          {sheet.notes ? <p className="app-muted" style={{ margin: "6px 0 0" }}>{sheet.notes}</p> : null}
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete sheet "${sheet.title}"?`)) {
              mutate({ action: "delete-sheet", sheetId: sheet.id });
            }
          }}
        >
          Delete
        </button>
      </header>

      {sheet.signals.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, marginTop: 12 }}>
          {sheet.signals.map((signal) => (
            <li
              key={signal.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <span className={`app-badge ${priorityTone(signal.priority)}`}>{signal.priority.toUpperCase()}</span>
                <strong style={{ marginLeft: 8 }}>{signal.code}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {signalKindLabel(signal.kind)} · called by {signalRoleLabel(signal.calledBy)}
                </small>
                <small className="app-muted">{signal.meaning}</small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "remove-signal", sheetId: sheet.id, signalId: signal.id })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <AddSignalForm sheetId={sheet.id} busy={busy} mutate={mutate} />
    </Panel>
  );
}

function AddSignalForm({
  sheetId,
  busy,
  mutate,
}: {
  sheetId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      code: "",
      meaning: "",
      kind: "hand_signal" as SignalKind,
      calledBy: "driver" as SignalRole,
      priority: "important" as SignalPriority,
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.code.trim() || !form.meaning.trim()) return;
        mutate({
          action: "add-signal",
          sheetId,
          code: form.code,
          meaning: form.meaning,
          kind: form.kind,
          calledBy: form.calledBy,
          priority: form.priority,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 8, marginTop: 12, borderTop: "1px solid var(--app-border, #33415522)", paddingTop: 12 }}
    >
      <FormGrid min={140}>
        <FormRow label="Code / gesture">
          <input value={form.code} onChange={set("code")} placeholder="Fist pump" required />
        </FormRow>
        <FormRow label="Kind">
          <select value={form.kind} onChange={set("kind")}>
            {SIGNAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {signalKindLabel(kind)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Called by">
          <select value={form.calledBy} onChange={set("calledBy")}>
            {SIGNAL_ROLES.map((role) => (
              <option key={role} value={role}>
                {signalRoleLabel(role)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {SIGNAL_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Meaning / what to do">
        <input value={form.meaning} onChange={set("meaning")} placeholder="Ready for endgame — start climb sequence" required />
      </FormRow>
      <div>
        <button type="submit" className="app-button secondary" disabled={busy || !form.code.trim() || !form.meaning.trim()}>
          Add signal
        </button>
      </div>
    </form>
  );
}
