"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { defaultDigestDate, type StandupView } from "../../lib/standup";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<StandupView, { status: "live" }>;
type EmptyView = Extract<StandupView, { status: "empty" }>;

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function isStandupView(value: unknown): value is StandupView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "live";
}

function standupCacheOrg(data: StandupView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "empty":
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistStandupSnapshot(
  orgHint: string,
  dateHint: string,
  data: StandupView,
): Promise<void> {
  const cacheOrg = standupCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const dateKey = data.digestDate || dateHint;
  try {
    await putFeatureSnapshot("standup-digest", cacheOrg, data, dateHint || dateKey);
    if (!orgHint) await putFeatureSnapshot("standup-digest", "_", data, dateHint || dateKey);
  } catch {
    // Live Morning standup already painted; IndexedDB is best-effort.
  }
}

function StandupRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={withOrgHref("/hours", orgId)}>
        Hours
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "goals-tracker", orgId)}>
        Season Goals
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "meeting-autopilot", orgId)}>
        Meeting agenda
      </Button>
    </nav>
  );
}

function StandupNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "hours",
      label: "Clock hours",
      detail: "Yesterday's digest is compiled from hours that actually closed.",
      href: withOrgHref("/hours", orgId),
      primary: true,
    },
    {
      id: "goals",
      label: "Open Season Goals",
      detail: "Season targets sit beside this morning summary.",
      href: hubHref("/team", "goals-tracker", orgId),
      primary: false,
    },
    {
      id: "meeting",
      label: "Open Meeting agenda",
      detail: "Agenda and minutes attach to a calendar meeting.",
      href: hubHref("/team", "meeting-autopilot", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function StandupDigestClient() {
  const [view, setView] = useState<StandupView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<StandupView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (dateOverride?: string) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const dateQuery = dateOverride ?? params.get("date") ?? "";
    const dateHint = dateQuery.trim() || defaultDigestDate();
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<StandupView>(
        "standup-digest",
        orgHint || "_",
        dateHint,
      );
      if (!viewRef.current && cached?.data && isStandupView(cached.data)) {
        setView(cached.data);
        setDate(cached.data.digestDate);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (dateHint) query.set("date", dateHint);
      const response = await fetch(
        `/api/standup-digest${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(responseError(data));
        return;
      }
      if (!response.ok || !isStandupView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Morning standup. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(responseError(data));
        return;
      }
      setView(data);
      setDate(data.digestDate);
      setFromCache(false);
      setCachedAt(null);
      await persistStandupSnapshot(orgHint, dateHint || data.digestDate, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Morning standup. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const digestDate = date ?? (view && "digestDate" in view ? view.digestDate : "");
  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Morning standup"}
        </>
      }
      title="Morning standup"
      description="Yesterday's closed hours and task movement — compiled only from work that actually happened."
    >
      {view && view.status !== "setup_required" ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Date
          <input
            type="date"
            value={digestDate}
            onChange={(event) => {
              const next = event.target.value;
              setDate(next);
              void load(next);
            }}
          />
        </label>
      ) : null}
      <StandupRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: errorMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: errorMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Morning standup" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking hours and work for this date."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Morning standup" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "empty":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Morning standup" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyDigest view={view} />
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Morning standup" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <StandupNextActions orgId={view.orgId} />
      <LiveDigest view={view} />
    </main>
  );
}

function EmptyDigest({ view }: { view: EmptyView }) {
  return (
    <EmptyState
      badge="No work yet"
      badgeTone="setup"
      title={view.message}
      description={
        view.standingBlockers > 0
          ? `${view.standingBlockers} blocked task${view.standingBlockers === 1 ? "" : "s"} are still open on Work — they are not yesterday's digest.`
          : "Clock hours or finish a task, then this page will compile that day. Nothing is invented while the logs are empty."
      }
    >
      {view.steps[0] ? (
        <Button as="a" variant="primary" href={view.steps[0].href}>
          {view.steps[0].label}
        </Button>
      ) : null}
    </EmptyState>
  );
}

function LiveDigest({ view }: { view: LiveView }) {
  const { digest } = view;
  const completed = digest.movement.filter((row) => row.event === "completed").length;
  const opened = digest.movement.filter((row) => row.event === "created").length;
  const blocked = digest.movement.filter((row) => row.event === "blocked").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{digest.digestDate}</h2>
            <small className="app-muted">{digest.headline}</small>
          </div>
        </header>
      </Panel>

      <Panel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <Tile label="Hours logged" value={String(digest.hours.totalHours)} />
          {completed > 0 ? <Tile label="Completed" value={String(completed)} /> : null}
          {opened > 0 ? <Tile label="Opened" value={String(opened)} /> : null}
          {blocked > 0 ? <Tile label="Blocked" value={String(blocked)} /> : null}
        </div>
      </Panel>

      {digest.hours.contributors.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Hours</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.hours.contributors.map((row) => (
              <li key={row.userId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{row.name}</span>
                <small className="app-muted">{row.hours}h</small>
              </li>
            ))}
          </ul>
          {digest.hours.byKind.length > 0 ? (
            <p className="app-muted" style={{ marginBottom: 0 }}>
              {digest.hours.byKind.map((row) => `${row.kind} ${row.hours}h`).join(" · ")}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {digest.movement.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Task movement</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.movement.map((item) => (
              <li key={`${item.source}:${item.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <a href={item.href}>{item.title}</a>
                  {item.grouping ? <small className="app-muted"> ({item.grouping})</small> : null}
                </span>
                <small className="app-muted">
                  {item.event}
                  {item.owners.length > 0 ? ` · ${item.owners.join(", ")}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {digest.blockers.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Open blockers</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.blockers.map((blocker) => (
              <li key={`${blocker.source}:${blocker.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <a href={blocker.href}>{blocker.title}</a>
                  {blocker.grouping ? <small className="app-muted"> ({blocker.grouping})</small> : null}
                </span>
                <small className="app-muted">
                  {blocker.owners.length > 0 ? `${blocker.owners.join(", ")} · ` : ""}
                  {blocker.ageDays}d old
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong style={{ fontSize: "1.6rem", display: "block" }}>{value}</strong>
      <span className="app-muted">{label}</span>
    </div>
  );
}
