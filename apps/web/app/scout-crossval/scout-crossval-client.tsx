"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { crossvalStatusLabel } from "../../lib/scout-crossval";
import type { ScoutCrossvalView } from "../../lib/scout-crossval/compute-scout-crossval";
import type { CrossvalEntry, CrossvalStatus } from "../../lib/scout-crossval/types";
import {
  SCOUT_CROSSVAL_RELATED_INCLUDE,
  classifyScoutCrossvalShell,
  formatScoutCrossvalMetric,
  formatScoutCrossvalRate,
  scoutCrossvalNextActions,
  scoutCrossvalRelatedLinks,
  scoutCrossvalSetupSteps,
  scoutCrossvalShellCopy,
  shouldShowScoutCrossvalSummaryTiles,
  type ScoutCrossvalNextAction,
  type ScoutCrossvalShellKind,
} from "../../lib/scout-crossval/scout-crossval-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./scout-crossval.css";

const STATUS_TONE: Record<CrossvalStatus, BadgeTone> = {
  agree: "good",
  conflict: "demo",
  unverifiable: "setup",
};

function statusTone(status: CrossvalStatus): BadgeTone {
  return STATUS_TONE[status] ?? "setup";
}

type LiveView = Extract<ScoutCrossvalView, { status: "live" }>;

function ScoutCrossvalRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutCrossvalRelatedLinks(orgId, {
    include: [...SCOUT_CROSSVAL_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-crossval-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ScoutCrossvalNextActionsPanel({ actions }: { actions: ScoutCrossvalNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-crossval-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ScoutCrossvalShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutCrossvalShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutCrossvalNextActions({ orgId, shell });
  const copy = scoutCrossvalShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const steps = shell === "setup" ? scoutCrossvalSetupSteps(orgId) : [];
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page scout-crossval-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Cross-Validation"}
          </>
        }
        title="Scout Cross-Validation"
        description={description}
      >
        <ScoutCrossvalRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading scout cross-validation">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={
            shell === "setup"
              ? "Setup required"
              : shell === "empty"
                ? "No entries yet"
                : copy.badge
          }
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <Button as="a" variant="primary" href={orgId ? scoutingHref : "/workspace"}>{orgId ? "Open Scouting" : "Choose your team"}</Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={scoutingHref}>Log scout entries</Button>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="scout-crossval-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-crossval-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-crossval-tip">{step.detail}</p>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <ScoutCrossvalNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutCrossvalClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutCrossvalView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(
    (eventOverride?: string) => {
      setFetchFailed(false);
      setError("");
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const urlOrg = initialOrgId ?? params.get("orgId");
      const eventQuery = eventOverride ?? params.get("eventKey");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (eventQuery) query.set("eventKey", eventQuery);
      void fetch(`/api/scout-crossval${query.toString() ? `?${query.toString()}` : ""}`)
        .then(async (response) => {
          const data = (await response.json()) as ScoutCrossvalView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setFetchFailed(true);
            setError("error" in data && data.error ? data.error : "Could not load scout cross-validation.");
            return;
          }
          setView(data);
          if ("eventKey" in data) setEventKey(data.eventKey);
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

  const totalEntries = view?.status === "live" ? view.summary.totalEntries : 0;
  const conflictEntries = view?.status === "live" ? view.summary.conflictEntries : 0;

  const shell = classifyScoutCrossvalShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    totalEntries,
  });
  const shellCopy = scoutCrossvalShellCopy(shell);
  const nextActions = scoutCrossvalNextActions({
    orgId,
    shell,
    conflictEntries,
    totalEntries,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutCrossvalSummaryTiles({ totalEntries: view.summary.totalEntries });
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return <ScoutCrossvalShell description={shellCopy.description} orgId={orgId} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <ScoutCrossvalShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup") {
    return (
      <ScoutCrossvalShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return <ScoutCrossvalShell description={shellCopy.description} orgId={orgId} shell="empty" />;
  }

  return (
    <main className="module-page scout-crossval-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Cross-Validation"}
          </>
        }
        title="Scout Cross-Validation"
        description="Compares saved match-scout entries against cached TBA score breakdowns — agree, conflict, or unverifiable."
      >
        <div className="scout-crossval-header-meta">
          <ScoutCrossvalRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      {view.events.length > 0 ? (
        <section className="scout-crossval-event" aria-label="Event filter">
          <label>
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
          <span className="app-muted">{view.eventKey}</span>
        </section>
      ) : null}

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <EntriesList view={view} busy={busy} mutate={mutate} />
      <ScoutCrossvalNextActionsPanel actions={nextActions} />
      <p className="app-muted scout-crossval-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={withOrgHref("/scout-coverage-live", orgId)}>Coverage Live</a>
        {" · "}
        <a href={withOrgHref("/scout-accuracy", orgId)}>Accuracy</a>
      </p>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  const hasVerifiable = summary.agreeEntries + summary.conflictEntries > 0;
  return (
    <section className="scout-crossval-kpis" aria-label="Cross-validation summary">
      <StatTile
        label="Scout entries"
        value={formatScoutCrossvalMetric(summary.totalEntries, loaded)}
        unit="match scout rows"
      />
      <StatTile
        label="Agree"
        value={formatScoutCrossvalMetric(summary.agreeEntries, loaded)}
        unit="vs TBA"
      />
      <StatTile
        label="Conflict"
        value={formatScoutCrossvalMetric(summary.conflictEntries, loaded)}
        unit="needs review"
      />
      <StatTile
        label="Unverifiable"
        value={formatScoutCrossvalMetric(summary.unverifiableEntries, loaded)}
        unit="no official field"
      />
      <StatTile
        label="Agreement rate"
        value={formatScoutCrossvalRate(summary.agreementRate, loaded, { hasVerifiable })}
        unit="verifiable only"
      />
    </section>
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
  return (
    <Panel className="scout-crossval-panel" id="crossval-entries">
      <header>
        <h2>Match entries vs TBA</h2>
        <p className="app-muted">
          Per-field badges use cached official score breakdowns only.
        </p>
      </header>
      {view.entries.length === 0 ? (
        <EmptyState
          soft
          badge="No scout entries yet"
          badgeTone="setup"
          title="No match-scout entries to cross-validate"
          description="Once scouts log match entries for this event, they appear here compared against cached official results."
        >
          <Button as="a" variant="primary" href={hubHref("/competition", "scouting", view.orgId)}>
            Open Scouting
          </Button>
        </EmptyState>
      ) : (
        <ul className="scout-crossval-list">
          {view.entries.map((entry) => (
            <EntryRow key={entry.matchScoutEntryId} entry={entry} busy={busy} mutate={mutate} />
          ))}
        </ul>
      )}
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
    <li>
      <div className="scout-crossval-row-head">
        <div>
          <strong>
            {entry.teamNumber != null ? `Team ${entry.teamNumber}` : entry.teamKey} · {entry.matchKey}
          </strong>
          <small>
            {entry.allianceColor ? `${entry.allianceColor} alliance` : "Alliance unknown"}
          </small>
        </div>
        <div className="scout-crossval-actions">
          <Badge tone={statusTone(entry.overallStatus)}>{crossvalStatusLabel(entry.overallStatus)}</Badge>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "run-crossval", matchScoutEntryId: entry.matchScoutEntryId })}>
            Re-check
          </Button>
        </div>
      </div>
      <ul className="scout-crossval-fields">
        {entry.fields.map((field) => (
          <li key={field.fieldKey}>
            <span>{field.fieldLabel}</span>
            <span className="app-muted">
              {field.scoutValue ?? "—"} vs {field.officialValue ?? "—"}{" "}
              <Badge tone={statusTone(field.status)}>{crossvalStatusLabel(field.status)}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
