"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EmptyState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  StatTile,
} from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { ScoutDataImpactView } from "../../lib/scout-data-impact/compute-scout-data-impact";
import {
  SCOUT_DATA_IMPACT_RELATED_INCLUDE,
  classifyScoutDataImpactShell,
  formatScoutDataImpactMetric,
  formatScoutDataImpactRate,
  scoutDataImpactNextActions,
  scoutDataImpactRelatedLinks,
  scoutDataImpactSetupSteps,
  scoutDataImpactShellCopy,
  shouldShowScoutDataImpactSummaryTiles,
  type ScoutDataImpactNextAction,
  type ScoutDataImpactShellKind,
} from "../../lib/scout-data-impact/scout-data-impact-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./scout-data-impact.css";

type LiveView = Extract<ScoutDataImpactView, { status: "live" }>;

function ScoutDataImpactRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutDataImpactRelatedLinks(orgId, {
    include: [...SCOUT_DATA_IMPACT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-data-impact-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ScoutDataImpactNextActionsPanel({ actions }: { actions: ScoutDataImpactNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-data-impact-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Scouting, Strategy, and Accuracy — never DEMO pick credit.</p>
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

function ScoutDataImpactShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
  logPick,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutDataImpactShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
  logPick?: ReactNode;
}) {
  const actions = scoutDataImpactNextActions({ orgId, shell });
  const copy = scoutDataImpactShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const steps = shell === "setup" ? scoutDataImpactSetupSteps(orgId) : [];
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
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const accuracyHref = withOrgHref("/scout-accuracy", orgId);

  return (
    <main className="module-page scout-data-impact-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Data Impact"}
          </>
        }
        title="Scout Data Impact"
        description={description}
      >
        <ScoutDataImpactRelatedStrip orgId={orgId} />
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
                ? "No picks yet"
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
          <a className="app-button" href={orgId ? strategyHref : "/workspace"}>
            {orgId ? "Open Strategy" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#log-alliance-pick">
              Log an alliance pick
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
            <a className="app-button secondary" href={accuracyHref}>
              Open Accuracy
            </a>
          </>
        ) : null}
      </EmptyState>
      {shell === "empty" || shell === "setup" ? logPick : null}
      {steps.length > 0 ? (
        <Panel className="scout-data-impact-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Strategy, and Accuracy — never DEMO pick credit.</p>
          </header>
          <ul className="scout-data-impact-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-data-impact-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <ScoutDataImpactNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutDataImpactClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutDataImpactView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(
    (eventOverride?: string) => {
      setFetchFailed(false);
      setFailureStatus(null);
      setError("");
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const urlOrg = initialOrgId ?? params.get("orgId");
      const eventQuery = eventOverride ?? params.get("eventKey");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (eventQuery) query.set("eventKey", eventQuery);
      void fetch(`/api/scout-data-impact${query.toString() ? `?${query.toString()}` : ""}`)
        .then(async (response) => {
          const data = (await response.json()) as ScoutDataImpactView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setFetchFailed(true);
            setFailureStatus(response.status);
            setError("error" in data && data.error ? data.error : "Could not load scout data impact.");
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
        const response = await fetch("/api/scout-data-impact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ScoutDataImpactView | { error?: string };
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

  const pickCount = view?.status === "live" ? view.picks.length : 0;
  const uncoveredPicks =
    view?.status === "live" ? view.picks.filter((item) => item.totalEntries === 0).length : 0;

  const shell = classifyScoutDataImpactShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    pickCount,
  });
  const shellCopy = scoutDataImpactShellCopy(shell);
  const nextActions = scoutDataImpactNextActions({
    orgId,
    shell,
    pickCount,
    uncoveredPicks,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutDataImpactSummaryTiles({
      pickCount: view.picks.length,
      totalEntries: view.totalEntries,
    });
  const loaded = view?.status === "live";
  const logPickForm = <LogPickForm busy={busy} mutate={mutate} />;

  if (shell === "loading") {
    return <ScoutDataImpactShell description={shellCopy.description} orgId={orgId} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <ScoutDataImpactShell
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
      <ScoutDataImpactShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        logPick={orgId ? logPickForm : null}
      />
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutDataImpactShell
        description={shellCopy.description}
        orgId={orgId}
        shell="empty"
        logPick={logPickForm}
      />
    );
  }

  return (
    <main className="module-page scout-data-impact-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Data Impact"}
          </>
        }
        title="Scout Data Impact"
        description="After alliance selection, see which real scouting entries informed each pick — where-your-data-went, never DEMO credit."
      >
        <div className="scout-data-impact-header-meta">
          <ScoutDataImpactRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      {view.events.length > 0 ? (
        <section className="scout-data-impact-event" aria-label="Event filter">
          <label>
            Event
            <select
              value={eventKey ?? view.eventKey}
              onChange={(event) => {
                const next = event.target.value;
                setEventKey(next);
                load(next);
              }}
            >
              {view.events.map((e) => (
                <option key={e.eventKey} value={e.eventKey}>
                  {e.name ?? e.eventKey}
                </option>
              ))}
            </select>
          </label>
          <span className="app-muted">{view.eventKey}</span>
        </section>
      ) : null}

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      {logPickForm}
      <ScoutSummaries view={view} loaded={loaded} />
      <PicksList view={view} busy={busy} mutate={mutate} loaded={loaded} />
      <ScoutDataImpactNextActionsPanel actions={nextActions} />
      <p className="app-muted scout-data-impact-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={hubHref("/competition", "strategy", orgId)}>Strategy</a>
        {" · "}
        <a href={withOrgHref("/scout-accuracy", orgId)}>Accuracy</a>
      </p>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const hasPicks = view.picks.length > 0;
  return (
    <section className="scout-data-impact-kpis" aria-label="Data impact summary">
      <StatTile
        label="Picks logged"
        value={formatScoutDataImpactMetric(view.picks.length, loaded)}
        unit="alliance selections"
      />
      <StatTile
        label="Entries credited"
        value={formatScoutDataImpactMetric(view.totalEntries, loaded)}
        unit="match scout rows"
      />
      <StatTile
        label="Scouts credited"
        value={formatScoutDataImpactMetric(view.scoutSummaries.length, loaded)}
        unit="membership-bound"
      />
      <StatTile
        label="Pick coverage"
        value={formatScoutDataImpactRate(view.coverageRatio, loaded, { hasPicks })}
        unit="picks with scout rows"
      />
    </section>
  );
}

function ScoutSummaries({ view, loaded }: { view: LiveView; loaded: boolean }) {
  return (
    <Panel className="scout-data-impact-panel">
      <header>
        <h2>Your data, credited</h2>
        <p className="app-muted">
          Scouts appear only when their real match entries match a logged pick — never DEMO influence.
        </p>
      </header>
      {view.scoutSummaries.length === 0 ? (
        <p className="app-muted">
          No scouting entries match the logged picks yet. Once match rows exist for a picked team, contributors show
          here.
        </p>
      ) : (
        <ul className="scout-data-impact-list">
          {view.scoutSummaries.map((scout) => (
            <li key={scout.scoutUserId}>
              <div className="scout-data-impact-row-head">
                <div>
                  <strong>{scout.scoutName}</strong>
                  <small>
                    {formatScoutDataImpactMetric(scout.teamsScoutedThatWerePicked.length, loaded)} picked team(s)
                    informed
                  </small>
                </div>
                <small className="app-muted">
                  {formatScoutDataImpactMetric(scout.totalEntries, loaded)} entries ·{" "}
                  {formatScoutDataImpactMetric(scout.picksInformed, loaded)} pick(s)
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PicksList({
  view,
  busy,
  mutate,
  loaded,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  loaded: boolean;
}) {
  return (
    <Panel className="scout-data-impact-panel" id="pick-evidence">
      <header>
        <h2>Picks and their evidence</h2>
        <p className="app-muted">Each pick lists only attributable scout entries for that team — never DEMO credit.</p>
      </header>
      {view.picks.length === 0 ? (
        <p className="app-muted">Log an alliance pick below to start the where-your-data-went loop.</p>
      ) : (
        <ul className="scout-data-impact-list">
          {view.picks.map((item) => (
            <li key={item.pick.id}>
              <div className="scout-data-impact-row-head">
                <div>
                  <strong>
                    Alliance {item.pick.allianceNumber} · Pick {item.pick.pickOrder} — Team{" "}
                    {item.pick.teamNumber ?? item.pick.teamKey}
                  </strong>
                  <small>
                    {formatScoutDataImpactMetric(item.totalEntries, loaded)} scouting entr
                    {item.totalEntries === 1 ? "y" : "ies"} informed this pick
                    {item.pick.notes ? ` · ${item.pick.notes}` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove pick for Team ${item.pick.teamNumber ?? item.pick.teamKey}?`,
                      )
                    ) {
                      void mutate({ action: "delete-pick", pickId: item.pick.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              {item.contributions.length > 0 ? (
                <ul className="scout-data-impact-contrib">
                  {item.contributions.map((c) => (
                    <li key={c.scoutUserId}>
                      <span>{c.scoutName}</span>
                      <small className="app-muted">
                        {formatScoutDataImpactMetric(c.entryCount, loaded)} entr
                        {c.entryCount === 1 ? "y" : "ies"} · {c.matchKeys.length} match(es)
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted" style={{ margin: 0 }}>
                  No scouting entries were found for this team at this event.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LogPickForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      eventKey: "",
      teamKey: "",
      allianceNumber: "1",
      pickOrder: "1",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      id="log-alliance-pick"
      className="scout-data-impact-panel scout-data-impact-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.eventKey.trim() || !form.teamKey.trim()) return;
        void mutate({
          action: "log-pick",
          eventKey: form.eventKey.trim(),
          teamKey: form.teamKey.trim(),
          allianceNumber: Number(form.allianceNumber) || 1,
          pickOrder: Number(form.pickOrder) || 1,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <header>
        <h2>Log alliance pick</h2>
        <p className="app-muted">Real picks only — credit attaches when matching scout rows exist.</p>
      </header>
      <FormGrid min={160}>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026txho" required />
        </FormRow>
        <FormRow label="Team key">
          <input value={form.teamKey} onChange={set("teamKey")} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Alliance #">
          <input type="number" min={1} max={8} value={form.allianceNumber} onChange={set("allianceNumber")} />
        </FormRow>
        <FormRow label="Pick order">
          <input type="number" min={1} value={form.pickOrder} onChange={set("pickOrder")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.eventKey.trim() || !form.teamKey.trim()}
        >
          Log pick
        </button>
      </div>
    </Panel>
  );
}
