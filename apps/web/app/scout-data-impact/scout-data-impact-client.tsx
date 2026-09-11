"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  EmptyState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  StatTile, Button } from "../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./scout-data-impact.css";

type LiveView = Extract<ScoutDataImpactView, { status: "live" }>;

function isScoutDataImpactView(value: unknown): value is ScoutDataImpactView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function scoutDataImpactCacheOrg(data: ScoutDataImpactView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistScoutDataImpactSnapshot(
  orgHint: string,
  eventHint: string,
  data: ScoutDataImpactView,
): Promise<void> {
  const cacheOrg = scoutDataImpactCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const eventKey = "eventKey" in data && data.eventKey ? data.eventKey : "";
  try {
    await putFeatureSnapshot("scout-data-impact", cacheOrg, data, eventHint || eventKey);
    if (!orgHint) await putFeatureSnapshot("scout-data-impact", "_", data, eventHint || eventKey);
  } catch {
    // Live Scout Data Impact already painted; IndexedDB is best-effort.
  }
}

function ScoutDataImpactRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutDataImpactRelatedLinks(orgId, {
    include: [...SCOUT_DATA_IMPACT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-data-impact-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
  const setup = shell === "setup" ? scoutDataImpactSetupSteps(orgId)[0] : null;
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
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#log-alliance-pick">Log an alliance pick</Button>
        ) : null}
      </EmptyState>
      {shell === "empty" || shell === "setup" ? logPick : null}
      {shell === "ready" ? <ScoutDataImpactNextActionsPanel actions={actions} /> : null}
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutDataImpactView | null>(null);
  viewRef.current = view;

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(
    (eventOverride?: string) => {
      void (async () => {
        const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
        const urlOrg = (initialOrgId ?? params.get("orgId"))?.trim() ?? "";
        const eventQuery = eventOverride ?? params.get("eventKey") ?? "";
        const eventHint = eventQuery.trim();
        let hadCache = Boolean(viewRef.current);
        try {
          const cached = await getFeatureSnapshot<ScoutDataImpactView>(
            "scout-data-impact",
            urlOrg || "_",
            eventHint,
          );
          if (!viewRef.current && cached?.data && isScoutDataImpactView(cached.data)) {
            setView(cached.data);
            if ("eventKey" in cached.data) setEventKey(cached.data.eventKey);
            setFromCache(true);
            setCachedAt(cached.cachedAt);
            hadCache = true;
          }
        } catch {
          // IndexedDB missing or blocked; live fetch still runs.
        }
        setFetchFailed(false);
        setFailureStatus(null);
        setError("");
        const query = new URLSearchParams();
        if (urlOrg) query.set("orgId", urlOrg);
        if (eventHint) query.set("eventKey", eventHint);
        try {
          const response = await fetch(
            `/api/scout-data-impact${query.toString() ? `?${query.toString()}` : ""}`,
            {
              cache: "no-store",
              signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
            },
          );
          const data = (await response.json()) as ScoutDataImpactView | { error?: string };
          if (response.status === 401 || response.status === 403) {
            setView(null);
            setFromCache(false);
            setCachedAt(null);
            setFetchFailed(true);
            setFailureStatus(response.status);
            setError("error" in data && data.error ? data.error : "Could not load scout data impact.");
            return;
          }
          if (!response.ok || !isScoutDataImpactView(data)) {
            if (hadCache || viewRef.current) {
              setFromCache(true);
              setError("Could not refresh Scout Data Impact. Showing the last copy on this device.");
              setFetchFailed(false);
            } else {
              setFetchFailed(true);
              setFailureStatus(response.status);
              setError("error" in data && data.error ? data.error : "Could not load scout data impact.");
            }
            return;
          }
          setView(data);
          if ("eventKey" in data) setEventKey(data.eventKey);
          setFromCache(false);
          setCachedAt(null);
          await persistScoutDataImpactSnapshot(urlOrg, eventHint, data);
        } catch {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Scout Data Impact. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
            setError("Network error — please try again.");
          }
        }
      })();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ScoutDataImpactView | { error?: string };
        if (!response.ok || !isScoutDataImpactView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if ("eventKey" in data) setEventKey(data.eventKey);
        void persistScoutDataImpactSnapshot(orgId, eventKey ?? "", data);
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
    return (
      <ScoutDataImpactShell description={shellCopy.description} orgId={orgId} shell="loading">
        <OfflineBanner feature="Scout Data Impact" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutDataImpactShell>
    );
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
      >
        <OfflineBanner feature="Scout Data Impact" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutDataImpactShell>
    );
  }
  if (shell === "setup") {
    return (
      <ScoutDataImpactShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        logPick={orgId ? logPickForm : null}
      >
        <OfflineBanner feature="Scout Data Impact" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutDataImpactShell>
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutDataImpactShell
        description={shellCopy.description}
        orgId={orgId}
        shell="empty"
        logPick={logPickForm}
      >
        <OfflineBanner feature="Scout Data Impact" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutDataImpactShell>
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
        description="After alliance selection, see which real scouting entries informed each pick — where-your-data-went."
      >
        <div className="scout-data-impact-header-meta">
          <ScoutDataImpactRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      <OfflineBanner feature="Scout Data Impact" fromCache={fromCache} cachedAt={cachedAt} />

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
        unit="signed-in scouts"
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
          Scouts appear only when their real match entries match a logged pick.
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
        <p className="app-muted">Each pick lists only attributable scout entries for that team.</p>
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
                <Button variant="secondary" type="button" disabled={busy} onClick={() => { if ( window.confirm( `Remove pick for Team ${item.pick.teamNumber ?? item.pick.teamKey}?`, ) ) { void mutate({ action: "delete-pick", pickId: item.pick.id }); } }}>
                  Delete
                </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.eventKey.trim() || !form.teamKey.trim()}>
          Log pick
        </Button>
      </div>
    </Panel>
  );
}
