"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { distinctValues, scoutDisagreementStatusLabel } from "../../lib/scout-disagreements";
import { type ScoutDisagreementsView } from "../../lib/scout-disagreements/compute-scout-disagreements";
import type { ScoutDisagreement } from "../../lib/scout-disagreements/types";
import {
  SCOUT_DISAGREEMENTS_RELATED_INCLUDE,
  classifyScoutDisagreementsShell,
  formatScoutDisagreementsMetric,
  scoutDisagreementsNextActions,
  scoutDisagreementsRelatedLinks,
  scoutDisagreementsSetupSteps,
  scoutDisagreementsShellCopy,
  shouldShowScoutDisagreementsSummaryTiles,
  type ScoutDisagreementsNextAction,
  type ScoutDisagreementsShellKind,
} from "../../lib/scout-disagreements/scout-disagreements-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./scout-disagreements.css";

function statusTone(status: ScoutDisagreement["status"]): string {
  if (status === "resolved") return "good";
  if (status === "dismissed") return "setup";
  return "";
}

type LiveView = Extract<ScoutDisagreementsView, { status: "live" }>;

function ScoutDisagreementsRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutDisagreementsRelatedLinks(orgId, {
    include: [...SCOUT_DISAGREEMENTS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav
      className="product-hub-related scout-disagreements-related"
      aria-label="Related competition tools"
    >
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ScoutDisagreementsNextActionsPanel({ actions }: { actions: ScoutDisagreementsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-disagreements-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Scouting, Accuracy, and Coverage — never DEMO conflicts.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ScoutDisagreementsShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutDisagreementsShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutDisagreementsNextActions({ orgId, shell });
  const copy = scoutDisagreementsShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const steps = shell === "setup" ? scoutDisagreementsSetupSteps(orgId) : [];
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const accuracyHref = withOrgHref("/scout-accuracy", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);

  return (
    <main className="module-page scout-disagreements-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Disagreements"}
          </>
        }
        title="Scout Disagreements"
        description={description}
      >
        <ScoutDisagreementsRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No disagreements yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? scoutingHref : "/workspace"}>
            {orgId ? "Open Scouting" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={scoutingHref}>
              Log scout entries
            </a>
            <a className="app-button secondary" href={accuracyHref}>
              Open Accuracy
            </a>
            <a className="app-button secondary" href={coverageHref}>
              Open Coverage
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="scout-disagreements-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Accuracy, and Coverage — never DEMO conflicts.</p>
          </header>
          <ul className="scout-disagreements-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-disagreements-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ScoutDisagreementsNextActionsPanel actions={actions} />
    </main>
  );
}

export default function ScoutDisagreementsClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutDisagreementsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(
    (seasonOverride?: number) => {
      setFetchFailed(false);
      setFailureStatus(null);
      setError("");
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const urlOrg = initialOrgId ?? params.get("orgId");
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonQuery) query.set("season", String(seasonQuery));
      void fetch(`/api/scout-disagreements${query.toString() ? `?${query.toString()}` : ""}`)
        .then(async (response) => {
          const data = (await response.json()) as ScoutDisagreementsView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setFetchFailed(true);
            setFailureStatus(response.status);
            setError("error" in data && data.error ? data.error : "Could not load scout disagreements.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFetchFailed(false);
        })
        .catch(() => {
          setFetchFailed(true);
          setError("Network error — please try again.");
        });
    },
    [initialOrgId],
  );

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

  const itemCount = view?.status === "live" ? view.items.length : 0;
  const openCount = view?.status === "live" ? view.summary.totalOpen : 0;

  const shell = classifyScoutDisagreementsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    itemCount,
  });
  const shellCopy = scoutDisagreementsShellCopy(shell);
  const nextActions = scoutDisagreementsNextActions({
    orgId,
    shell,
    itemCount,
    openCount,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutDisagreementsSummaryTiles({
      totalOpen: view.summary.totalOpen,
      totalResolved: view.summary.totalResolved,
      totalDismissed: view.summary.totalDismissed,
    });
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <ScoutDisagreementsShell description={shellCopy.description} orgId={orgId} shell="loading" />
    );
  }

  if (shell === "error") {
    return (
      <ScoutDisagreementsShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={failureStatus}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <ScoutDisagreementsShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutDisagreementsShell description={shellCopy.description} orgId={orgId} shell="empty">
        <LogDisagreementForm busy={busy} mutate={mutate} />
      </ScoutDisagreementsShell>
    );
  }

  return (
    <main className="module-page scout-disagreements-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Disagreements"}
          </>
        }
        title="Scout Disagreements"
        description="Resolve conflicting scouted field values between scouts, with an immutable audit trail — never DEMO conflicts."
      >
        <div className="scout-disagreements-header-meta">
          <ScoutDisagreementsRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      {view.seasons.length > 0 ? (
        <section className="scout-disagreements-season" aria-label="Season filter">
          <label>
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
        </section>
      ) : null}

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <LogDisagreementForm busy={busy} mutate={mutate} />
      <Queue view={view} busy={busy} mutate={mutate} />
      <AuditLog view={view} />
      <ScoutDisagreementsNextActionsPanel actions={nextActions} />
      <p className="app-muted scout-disagreements-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={withOrgHref("/scout-accuracy", orgId)}>Accuracy</a>
        {" · "}
        <a href={withOrgHref("/scouting/lineup", orgId)}>Coverage</a>
      </p>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  return (
    <section className="scout-disagreements-kpis" aria-label="Disagreement summary">
      <article>
        <span>Open</span>
        <strong>{formatScoutDisagreementsMetric(summary.totalOpen, loaded)}</strong>
        <small>awaiting resolve</small>
      </article>
      <article>
        <span>Resolved</span>
        <strong>{formatScoutDisagreementsMetric(summary.totalResolved, loaded)}</strong>
        <small>authoritative set</small>
      </article>
      <article>
        <span>Dismissed</span>
        <strong>{formatScoutDisagreementsMetric(summary.totalDismissed, loaded)}</strong>
        <small>not a conflict</small>
      </article>
      <article>
        <span>Matches</span>
        <strong>{formatScoutDisagreementsMetric(summary.distinctMatches, loaded)}</strong>
        <small>affected</small>
      </article>
      <article>
        <span>Fields</span>
        <strong>{formatScoutDisagreementsMetric(summary.distinctFields, loaded)}</strong>
        <small>affected</small>
      </article>
    </section>
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
        soft
        badge="No disagreements yet"
        badgeTone="setup"
        title="Log your first conflicting field"
        description="When two scouts report different values for the same match/team/field, log it here — never DEMO conflicts."
      >
        <a className="app-button" href={hubHref("/competition", "scouting", view.orgId)}>
          Open Scouting
        </a>
        <a className="app-button secondary" href={withOrgHref("/scout-accuracy", view.orgId)}>
          Open Accuracy
        </a>
        <a className="app-button secondary" href={withOrgHref("/scouting/lineup", view.orgId)}>
          Open Coverage
        </a>
      </EmptyState>
    );
  }
  return (
    <Panel className="scout-disagreements-panel" id="disagreement-queue" aria-label="Resolution queue">
      <header>
        <h2>Resolution queue</h2>
        <p className="app-muted">Real scout submissions only — never DEMO conflicts.</p>
      </header>
      <ul className="scout-disagreements-list">
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
    <li>
      <div className="scout-disagreements-row-head">
        <div>
          <span className={`app-badge ${statusTone(item.status)}`.trim()}>
            {scoutDisagreementStatusLabel(item.status)}
          </span>
          <strong style={{ display: "block", marginTop: 4 }}>
            Match {item.matchNumber} · Team {item.teamNumber} · {item.fieldLabel}
          </strong>
          <small>
            {item.values.map((value) => `${value.source}: ${value.value}`).join("  ·  ")}
          </small>
        </div>
      </div>

      {item.status === "resolved" ? (
        <small>
          Resolved to <strong>{item.resolvedValue}</strong>
          {item.resolutionNote ? ` — ${item.resolutionNote}` : ""}
        </small>
      ) : null}

      {item.status === "open" ? (
        <div className="scout-disagreements-actions">
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
          />
          <button
            type="button"
            className="app-button"
            disabled={busy || !choice}
            onClick={() => {
              mutate({
                action: "resolve",
                disagreementId: item.id,
                resolvedValue: choice,
                note: note || undefined,
              });
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
    <Panel className="scout-disagreements-panel" aria-label="Audit trail">
      <header>
        <h2>Audit trail</h2>
        <p className="app-muted">Immutable decisions on real conflicts only.</p>
      </header>
      <ul className="scout-disagreements-audit">
        {view.auditLog.map((entry) => (
          <li key={entry.id}>
            <span>
              {entry.action}
              {entry.previousStatus && entry.newStatus
                ? ` (${entry.previousStatus} → ${entry.newStatus})`
                : ""}
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
      className="scout-disagreements-panel scout-disagreements-form"
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
    >
      <header>
        <h2>Log a disagreement</h2>
        <p className="app-muted">Manual entry for real scout conflicts — never DEMO rows.</p>
      </header>
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
