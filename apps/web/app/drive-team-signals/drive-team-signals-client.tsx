"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { SIGNAL_KINDS, SIGNAL_PRIORITIES, SIGNAL_ROLES, signalKindLabel, signalRoleLabel } from "../../lib/drive-team-signals";
import type { DriveTeamSignalsView } from "../../lib/drive-team-signals/compute-drive-team-signals";
import type {
  DriveTeamSignalSheet,
  SignalKind,
  SignalPriority,
  SignalRole,
} from "../../lib/drive-team-signals/types";
import {
  DRIVE_TEAM_SIGNALS_RELATED_INCLUDE,
  classifyDriveTeamSignalsShell,
  formatDriveTeamSignalsMetric,
  driveTeamSignalsNextActions,
  driveTeamSignalsRelatedLinks,
  driveTeamSignalsSetupSteps,
  driveTeamSignalsShellCopy,
  shouldShowDriveTeamSignalsSummaryTiles,
  type DriveTeamSignalsNextAction,
  type DriveTeamSignalsShellKind,
} from "../../lib/drive-team-signals/drive-team-signals-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./drive-team-signals.css";

type LiveView = Extract<DriveTeamSignalsView, { status: "live" }>;

const priorityTone: Record<SignalPriority, BadgeTone> = {
  critical: "danger",
  important: "setup",
  fyi: "good",
};

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = driveTeamSignalsRelatedLinks(orgId, {
    include: [...DRIVE_TEAM_SIGNALS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related dts-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: DriveTeamSignalsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions dts-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Match Checklist, Strategy Cards, and Copilot — never DEMO cheat sheets.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SignalsShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  shell: DriveTeamSignalsShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = driveTeamSignalsNextActions({ orgId, shell });
  const copy = driveTeamSignalsShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "drive-team-signals", orgId);
  const steps = shell === "setup" ? driveTeamSignalsSetupSteps(orgId) : [];

  return (
    <main className="module-page dts-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Drive-Team Signals"}
          </>
        }
        title="Drive-Team Signal Board"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading drive-team signals">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/competition", "match-checklist", orgId)}>
                Open Match Checklist
              </a>
              <a className="app-button secondary" href={hubHref("/team", "field-reset-timer", orgId)}>
                Open Field Reset Timer
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="dts-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Match Checklist and Strategy Cards — never DEMO cheat sheets.</p>
          </header>
          <ul className="dts-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted dts-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function DriveTeamSignalsClient() {
  const [view, setView] = useState<DriveTeamSignalsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sheetCount = view?.status === "live" ? view.summary.totalSheets : 0;
  const signalCount = view?.status === "live" ? view.summary.totalSignals : 0;

  const shell = classifyDriveTeamSignalsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    sheetCount,
  });
  const shellCopy = driveTeamSignalsShellCopy(shell);
  const nextActions = driveTeamSignalsNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    sheetCount,
    signalCount,
  });
  const competitionHref = hubWorkbenchHref("competition", "drive-team-signals", orgId);
  const showTiles = shouldShowDriveTeamSignalsSummaryTiles(sheetCount, signalCount);
  const loaded = view?.status === "live";

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

  if (shell === "loading") {
    return <SignalsShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <SignalsShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <SignalsShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page dts-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Drive-Team Signals"}
          </>
        }
        title="Drive-Team Signal Board"
        description="Standardized driver/human-player comms cheat-sheets — never DEMO signal packs."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <div className="dts-stats">
          <StatTile label="Sheets" value={formatDriveTeamSignalsMetric(view.summary.totalSheets, loaded)} />
          <StatTile label="Signals" value={formatDriveTeamSignalsMetric(view.summary.totalSignals, loaded)} />
          <StatTile label="Critical" value={formatDriveTeamSignalsMetric(view.summary.criticalSignals, loaded)} />
        </div>
      ) : null}

      <CreateSheetForm busy={busy} mutate={mutate} />
      <SheetList view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
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
      id="drive-team-signals-new"
      className="dts-panel"
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
    >
      <h2>New signal sheet</h2>
      <p className="app-muted dts-tip">Real drive-crew language only — never DEMO cheat sheets.</p>
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
        soft
        badge="No sheets yet"
        badgeTone="setup"
        title="Create your first signal sheet"
        description="Standardize hand signals, callouts, and radio codes your drive team uses — never DEMO cheat sheets."
      />
    );
  }
  return (
    <div id="drive-team-signals-sheets" className="dts-sheets">
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
    <Panel className="dts-panel">
      <header className="dts-sheet-header">
        <div>
          <h2>{sheet.title}</h2>
          <small className="app-muted">
            {sheet.gameYear}
            {sheet.eventKey ? ` · ${sheet.eventKey}` : ""} · {sheet.signals.length} signal(s)
          </small>
          {sheet.notes ? <p className="app-muted dts-tip">{sheet.notes}</p> : null}
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
        <ul className="dts-list">
          {sheet.signals.map((signal) => (
            <li key={signal.id} className="dts-row">
              <div>
                <Badge tone={priorityTone[signal.priority]}>{signal.priority.toUpperCase()}</Badge>
                <strong className="dts-code">{signal.code}</strong>
                <small className="app-muted dts-block">
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
      className="dts-add-signal"
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
        <input
          value={form.meaning}
          onChange={set("meaning")}
          placeholder="Ready for endgame — start climb sequence"
          required
        />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button secondary"
          disabled={busy || !form.code.trim() || !form.meaning.trim()}
        >
          Add signal
        </button>
      </div>
    </form>
  );
}
