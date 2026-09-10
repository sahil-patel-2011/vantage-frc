"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import PartnerPlacement from "../../components/partner-placement";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { visibilityPollDelay } from "../../lib/perf/visibility-poll";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
} from "../../lib/offline";
import {
  PIT_BOARD_POLL_MS,
  pitTurnaroundFromSchedule,
  pitTurnaroundLabel,
  type PitBoardFlags,
  type PitTurnaround,
} from "../../lib/pit/board";
import {
  PIT_RELATED_INCLUDE,
  classifyPitShell,
  formatPitBatteryReady,
  formatPitMetric,
  pitNextActions,
  pitRelatedLinks,
  pitShellCopy,
  shouldShowPitSummaryTiles,
  type PitNextAction,
  type PitShellKind,
} from "../../lib/pit/pit-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

type Data = {
  organization: { name: string; teamNumber: number | null; role: string };
  context: { eventKey: string | null; eventName: string | null };
  nextMatch: {
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
  } | null;
  status?: "empty" | "live";
  flags?: PitBoardFlags;
  turnaround?: PitTurnaround | null;
  gate: { state: "empty" | "go" | "check" | "hold"; reasons: string[] };
  summary: {
    openIssues: number;
    overdueMaintenance: number;
    readyBatteries: number;
    activeBatteries: number;
    repeatFailureSubsystems?: number;
  };
  repeatAlerts?: Array<{
    subsystemName: string;
    failureCount: number;
    openCount: number;
    level: string;
    message: string;
    recentTitles: string[];
    href: string;
  }>;
  issues: Array<{
    id: string;
    subsystem: string;
    severity: string;
    symptoms: string;
    occurredAt: string;
    matchKey: string | null;
    canResolve: boolean;
  }>;
  maintenance: Array<{ id: string; subsystem: string; task: string; dueAt: string | null }>;
  batteries: Array<{
    id: string;
    assetTag: string;
    status: "active" | "service" | "retired";
    measuredAt: string | null;
    voltage: number | null;
    resistanceMilliohms: number | null;
    gate: "ready" | "review" | "unread";
  }>;
  rules: { battery: string; hold: string };
  updatedAt: string;
};

type Form = { kind: "battery" | "issue" | "maintenance" | "resolve"; id?: string } | null;

const subsystems = [
  "Drivetrain",
  "Game piece mechanism",
  "Electrical",
  "Controls",
  "Pneumatics",
  "Structure",
  "Bumpers",
  "Other",
];

const ago = (value: string | null) => {
  if (!value) return "No reading";
  const m = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  return m < 1
    ? "just now"
    : m < 60
      ? `${m}m ago`
      : m < 2160
        ? `${Math.round(m / 60)}h ago`
        : new Date(value).toLocaleDateString();
};

const due = (value: string | null) => {
  if (!value) return "No deadline";
  const d = new Date(value);
  return `${d.getTime() < Date.now() ? "Overdue · " : "Due "}${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
};

const matchLabel = (value: Data["nextMatch"]) =>
  !value
    ? "No upcoming match"
    : value.compLevel === "qm"
      ? `Qualification ${value.matchNumber}`
      : `${value.compLevel.toUpperCase()} ${value.matchNumber}`;

const countdown = (
  data: Pick<Data, "turnaround" | "flags" | "nextMatch">,
  now: number,
) => {
  const turnaround =
    data.turnaround !== undefined
      ? data.turnaround
      : pitTurnaroundFromSchedule(data.nextMatch?.scheduledTime, now);
  const label = pitTurnaroundLabel(turnaround);
  if (label) return label;
  if (data.flags?.queue && data.nextMatch) return "Time pending";
  return "—";
};

function PitRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pitRelatedLinks(orgId, {
    include: [...PIT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pit-related" aria-label="Related pit tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function PitNextActionsPanel({ actions }: { actions: PitNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions pit-next-actions" aria-label="Next actions">
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

function PitShell({
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
  shell: PitShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session offers sign-in, not Retry. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = pitNextActions({ orgId, shell });
  const copy = pitShellCopy(shell);
  // A failed load names its own recovery — Retry cannot fix an expired session.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || copy.description,
          },
        )
      : null;
  const competitionHref = withOrgHref("/competition", orgId);

  return (
    <main className="module-page pit-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pit command"}
          </>
        }
        title="Pit command"
        description={description}
      >
        <PitRelatedStrip orgId={orgId} />
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
                ? "No pit evidence yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && failure?.showRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#pit-actions">Log first evidence</Button>
        ) : null}
      </EmptyState>
      <PitNextActionsPanel actions={actions} />
    </main>
  );
}

export default function PitCommandClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cached = orgId ? await getFeatureSnapshot<Data>("pit", orgId) : null;
    if (cached?.data) {
      setData(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
      setLoading(false);
    }
    try {
      const r = await fetch(`/api/pit?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const body = (await r.json()) as Data | { error?: string };
      if (!r.ok || !("gate" in body)) {
        if (!cached) {
          setFetchFailed(true);
          setErrorStatus(r.status);
          setError("error" in body && body.error ? body.error : "Could not load Pit command");
        }
        return;
      }
      setData(body);
      setFetchFailed(false);
      setErrorStatus(null);
      setError("");
      setFromCache(false);
      setCachedAt(null);
      if (orgId) await putFeatureSnapshot("pit", orgId, body);
    } catch (e) {
      if (!cached) {
        setFetchFailed(true);
        setErrorStatus(null);
        setError(e instanceof Error ? e.message : "Could not load Pit command");
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
    let timer: number | null = null;
    let cancelled = false;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState !== "hidden") void load();
        if (!cancelled) schedule();
      }, visibilityPollDelay(PIT_BOARD_POLL_MS, document.visibilityState === "hidden"));
    };
    schedule();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onOnline = () => {
      void syncOutbox({ orgId }).then(() => load());
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [load, orgId]);

  async function mutate(payload: Record<string, unknown>, success: string, key = String(payload.action)) {
    if (isBrowserOffline()) {
      await queueProductWrite({
        feature: "pit_board",
        orgId,
        payload: { ...payload, orgId },
      });
      setError(QUEUED_ON_DEVICE);
      return;
    }
    setBusy(key);
    setError("");
    try {
      const r = await fetch("/api/pit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, orgId }),
      });
      const body = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Pit action failed");
      setMessage(success);
      setForm(null);
      await load();
    } catch (e) {
      if (isBrowserOffline()) {
        await queueProductWrite({
          feature: "pit_board",
          orgId,
          payload: { ...payload, orgId },
        });
        setError(QUEUED_ON_DEVICE);
        return;
      }
      setError(e instanceof Error ? e.message : "Pit action failed");
    } finally {
      setBusy("");
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (form.kind === "battery") void mutate({ action: "log_battery", ...values }, "Battery reading logged.", "form");
    else if (form.kind === "issue")
      void mutate(
        { action: "report_issue", matchKey: data?.nextMatch?.matchKey ?? "", ...values },
        "Issue added to the board.",
        "form",
      );
    else if (form.kind === "maintenance")
      void mutate({ action: "add_maintenance", ...values }, "Maintenance item added.", "form");
    else void mutate({ action: "resolve_issue", id: form.id, ...values }, "Issue resolved and gate recalculated.", "form");
  }

  const rack = useMemo(() => data?.batteries.filter((b) => b.status !== "retired") ?? [], [data]);
  const batteryCount = rack.length;
  const openIssues = data?.summary.openIssues ?? 0;
  const maintenanceCount = data?.maintenance.length ?? 0;

  const shell = classifyPitShell({
    loading: loading && !data,
    fetchFailed: fetchFailed && !data,
    orgId,
    batteryCount,
    openIssues,
    maintenanceCount,
    flags: data?.flags,
  });
  const shellCopy = pitShellCopy(shell);
  const nextActions = pitNextActions({
    orgId,
    shell,
    batteryCount,
    openIssues,
    overdueMaintenance: data?.summary.overdueMaintenance ?? 0,
    readyBatteries: data?.summary.readyBatteries ?? 0,
    activeBatteries: data?.summary.activeBatteries ?? 0,
  });
  const relatedLinks = pitRelatedLinks(orgId, { include: [...PIT_RELATED_INCLUDE] });
  const competitionHref = withOrgHref("/competition", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const showSummary = shouldShowPitSummaryTiles({
    batteryCount,
    openIssues,
    maintenanceCount,
  });
  const loaded = Boolean(data);

  if (shell === "loading") {
    return <PitShell description={shellCopy.description} orgId={orgId} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <PitShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={errorStatus}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      />
    );
  }

  if (!data) {
    return (
      <PitShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={errorStatus}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      />
    );
  }

  return (
    <main className="module-page pit-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pit command"}
            {data.organization.teamNumber != null ? ` · Team ${data.organization.teamNumber}` : ""}
          </>
        }
        title="Robot release board"
        description={
          shell === "empty"
            ? shellCopy.description
            : `${data.context.eventName ?? "No active event"} · counts come from logs and issues your team entered`
        }
      >
        <PitRelatedStrip orgId={orgId} />
        <div className="pit-next">
          <span>NEXT MATCH</span>
          <strong>{matchLabel(data.nextMatch)}</strong>
          <b>{countdown(data, now)}</b>
        </div>
      </PageHeader>
      <OfflineBanner feature="Pit" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="telemetry-status success" role="status">
          {message}
        </p>
      ) : null}

      {shell === "empty" ? (
        <>
          <EmptyState
            soft
            badge="No pit evidence yet"
            badgeTone="setup"
            title={shellCopy.title}
            description={shellCopy.description}
          >
            <Button as="a" variant="primary" href="#pit-actions">
              Log first evidence
            </Button>
          </EmptyState>
          
        </>
      ) : null}

      <section className={`pit-gate ${data.gate.state}`}>
        <div className="pit-gate-state">
          <span>RELEASE GATE</span>
          <strong>{data.gate.state === "empty" ? "—" : data.gate.state.toUpperCase()}</strong>
          <small>
            {data.gate.state === "empty"
              ? "Empty until repairs, batteries, or queue rows"
              : data.gate.state === "go"
                ? "Evidence clear"
                : data.gate.state === "hold"
                  ? "Do not release"
                  : "Crew review needed"}
          </small>
        </div>
        <div className="pit-reasons">
          <span>WHY</span>
          <ul>
            {data.gate.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        {showSummary ? (
          <dl>
            <div>
              <dt>Issues</dt>
              <dd>{formatPitMetric(data.summary.openIssues, loaded)}</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>{formatPitMetric(data.summary.overdueMaintenance, loaded)}</dd>
            </div>
            <div>
              <dt>Batteries</dt>
              <dd>
                {formatPitBatteryReady(
                  data.summary.readyBatteries,
                  data.summary.activeBatteries,
                  loaded,
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <dl>
            <div>
              <dt>Issues</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Batteries</dt>
              <dd>—</dd>
            </div>
          </dl>
        )}
      </section>

      {data.repeatAlerts?.length ? (
        <section className="pit-repeat" aria-label="Repeat failure patterns">
          <header>
            <div>
              <span>SEASON PATTERN</span>
              <h2>Repeat failures</h2>
            </div>
            <a href={fmeaHref}>Open FMEA log</a>
          </header>
          <ul>
            {data.repeatAlerts.map((alert) => (
              <li key={alert.subsystemName} data-level={alert.level}>
                <strong>{alert.message}</strong>
                <span>
                  {alert.openCount} still open
                  {alert.recentTitles.length ? ` · ${alert.recentTitles.slice(0, 2).join("; ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pit-actions" id="pit-actions">
        <button type="button" onClick={() => setForm({ kind: "battery" })}>
          <span>01</span>
          <strong>Log battery</strong>
          <small>Voltage + resistance</small>
        </button>
        <button type="button" onClick={() => setForm({ kind: "issue" })}>
          <span>02</span>
          <strong>Report issue</strong>
          <small>Put it on the board</small>
        </button>
        <button type="button" onClick={() => setForm({ kind: "maintenance" })}>
          <span>03</span>
          <strong>Add work</strong>
          <small>Task + due time</small>
        </button>
        <button type="button" onClick={() => void load()}>
          <span>↻</span>
          <strong>Refresh gate</strong>
          <small>Recheck now</small>
        </button>
      </section>

      {form ? (
        <section className="pit-capture">
          <header>
            <div>
              <span>FAST CAPTURE</span>
              <h2>
                {form.kind === "battery"
                  ? "Battery check"
                  : form.kind === "issue"
                    ? "Report robot issue"
                    : form.kind === "maintenance"
                      ? "Add maintenance"
                      : "Close issue"}
              </h2>
            </div>
            <button type="button" aria-label="Close" onClick={() => setForm(null)}>
              ×
            </button>
          </header>
          <form onSubmit={submit}>
            {form.kind === "battery" ? (
              <>
                <label>
                  Battery tag
                  <input name="assetTag" autoFocus required placeholder="COMP-04" />
                </label>
                <label>
                  Voltage
                  <input name="voltage" type="number" step=".01" min="0" max="20" placeholder="12.74" />
                </label>
                <label>
                  Resistance (mΩ)
                  <input
                    name="resistanceMilliohms"
                    type="number"
                    step=".1"
                    min="0"
                    max="100"
                    placeholder="18.2"
                  />
                </label>
                <label>
                  Charger cycles
                  <input name="chargerCycles" type="number" min="0" step="1" placeholder="Optional" />
                </label>
              </>
            ) : null}
            {form.kind === "issue" ? (
              <>
                <label>
                  Subsystem
                  <select name="subsystem" autoFocus>
                    {subsystems.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select name="severity" defaultValue="degraded">
                    <option value="minor">Minor</option>
                    <option value="degraded">Degraded</option>
                    <option value="disabled">Robot disabled</option>
                    <option value="safety">Safety — hold</option>
                  </select>
                </label>
                <label className="wide">
                  What happened?
                  <textarea name="symptoms" required rows={3} maxLength={2000} />
                </label>
              </>
            ) : null}
            {form.kind === "maintenance" ? (
              <>
                <label>
                  Subsystem
                  <select name="subsystem" autoFocus>
                    {subsystems.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Due time
                  <input name="dueAt" type="datetime-local" />
                </label>
                <label className="wide">
                  Work item
                  <textarea name="task" required rows={3} maxLength={500} />
                </label>
              </>
            ) : null}
            {form.kind === "resolve" ? (
              <label className="wide">
                Resolution
                <textarea
                  name="resolution"
                  autoFocus
                  required
                  rows={3}
                  maxLength={2000}
                  placeholder="What changed, and how was it verified?"
                />
              </label>
            ) : null}
            <footer>
              <Button variant="secondary" type="button" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy === "form"}>
                {busy === "form" ? "Saving…" : "Save to pit board"}
              </Button>
            </footer>
          </form>
        </section>
      ) : null}

      <section className="pit-grid">
        <article className="pit-card" id="pit-issues">
          <header>
            <div>
              <span>ROBOT</span>
              <h2>Open issues</h2>
            </div>
            <b>{showSummary ? formatPitMetric(data.issues.length, loaded) : "—"}</b>
          </header>
          {!data.issues.length ? (
            <div className="pit-empty">
              <strong>No open robot issues</strong>
              <span>Report anything the next crew needs to know.</span>
            </div>
          ) : (
            <ul className="pit-issues">
              {data.issues.map((i) => (
                <li key={i.id} data-severity={i.severity}>
                  <div>
                    <em>{i.severity}</em>
                    <time>{ago(i.occurredAt)}</time>
                  </div>
                  <strong>{i.subsystem}</strong>
                  <p>{i.symptoms}</p>
                  {i.canResolve ? (
                    <button type="button" onClick={() => setForm({ kind: "resolve", id: i.id })}>
                      Resolve + verify
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="pit-card" id="pit-maintenance">
          <header>
            <div>
              <span>WORK QUEUE</span>
              <h2>Maintenance</h2>
            </div>
            <b>{showSummary ? formatPitMetric(data.maintenance.length, loaded) : "—"}</b>
          </header>
          {!data.maintenance.length ? (
            <div className="pit-empty">
              <strong>Work queue clear</strong>
              <span>Add inspections or between-match repairs here.</span>
            </div>
          ) : (
            <ul className="pit-work">
              {data.maintenance.map((i) => (
                <li
                  key={i.id}
                  className={i.dueAt && new Date(i.dueAt).getTime() < now ? "overdue" : ""}
                >
                  <button
                    type="button"
                    disabled={busy === i.id}
                    onClick={() =>
                      void mutate({ action: "complete_maintenance", id: i.id }, "Maintenance completed.", i.id)
                    }
                  >
                    ✓
                  </button>
                  <div>
                    <span>{i.subsystem}</span>
                    <strong>{i.task}</strong>
                    <small>{due(i.dueAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="pit-card pit-battery" id="pit-batteries">
          <header>
            <div>
              <span>POWER</span>
              <h2>Battery rack</h2>
            </div>
            <b>
              {formatPitBatteryReady(
                data.summary.readyBatteries,
                data.summary.activeBatteries,
                loaded,
              )}
            </b>
          </header>
          {!rack.length ? (
            <div className="pit-empty">
              <strong>No batteries tracked</strong>
              <span>
                Log a reading to create the first record, or{" "}
                <a href={batteriesHref}>open Batteries</a>
              </span>
            </div>
          ) : (
            <ul>
              {rack.map((b) => (
                <li key={b.id} data-gate={b.gate}>
                  <div>
                    <strong>{b.assetTag}</strong>
                    <small>{b.status}</small>
                  </div>
                  <div>
                    <strong>{b.voltage == null ? "—" : `${Number(b.voltage).toFixed(2)} V`}</strong>
                    <small>
                      {b.resistanceMilliohms == null
                        ? "IR —"
                        : `${Number(b.resistanceMilliohms).toFixed(1)} mΩ`}
                    </small>
                  </div>
                  <div>
                    <b>{b.gate.toUpperCase()}</b>
                    <small>{ago(b.measuredAt)}</small>
                  </div>
                  <button
                    type="button"
                    disabled={busy === b.id}
                    onClick={() =>
                      void mutate(
                        {
                          action: "battery_status",
                          id: b.id,
                          status: b.status === "service" ? "active" : "service",
                        },
                        b.status === "service"
                          ? "Battery returned to active rack."
                          : "Battery moved to service.",
                        b.id,
                      )
                    }
                  >
                    {b.status === "service" ? "Return" : "Service"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <footer>
            <strong>READY RANGE</strong>
            <span>{data.rules.battery}</span>
          </footer>
        </article>
      </section>

      <PitNextActionsPanel actions={nextActions} />

      {relatedLinks.length ? (
        <nav className="product-hub-related pit-related pit-related-footer" aria-label="More pit tools">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </nav>
      ) : null}

      <PartnerPlacement orgId={orgId} surface="pit_footer" title="Pit command partners" />
      <footer className="pit-foot">
        <span>Last calculated {new Date(data.updatedAt).toLocaleTimeString()}</span>
        <span>
          Human release decision stays with the pit crew · {data.rules.hold}
        </span>
      </footer>
    </main>
  );
}
