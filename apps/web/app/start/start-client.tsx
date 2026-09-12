"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { RoleOnboardingView, StartTrackView } from "../../lib/role-onboarding";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function isStartView(value: unknown): value is RoleOnboardingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  if (status === "setup_required") {
    return typeof (value as { message?: unknown }).message === "string";
  }
  if (status === "live") {
    return typeof (value as { orgId?: unknown }).orgId === "string";
  }
  return false;
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function startCacheOrg(data: RoleOnboardingView, orgHint: string): string {
  if (data.status === "live" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistStartSnapshot(orgHint: string, data: RoleOnboardingView): Promise<void> {
  const cacheOrg = startCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("start", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("start", "_", data);
  } catch {
    // Live Your path already painted; IndexedDB is best-effort.
  }
}

function StartRelated({ orgId }: { orgId: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={withOrgHref("/team/getting-started", orgId)}>
        Team setup
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/calendar", orgId)}>
        Calendar
      </Button>
      <Button as="a" variant="secondary" href="/security">
        Security
      </Button>
    </nav>
  );
}

function StartNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "getting-started",
      label: "Open Team setup",
      detail: "Invites, knowledge, and budgets for the whole team.",
      href: withOrgHref("/team/getting-started", orgId),
      primary: true,
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Join a subteam so practices and build sessions show up.",
      href: withOrgHref("/team/calendar", orgId),
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

export default function StartClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<RoleOnboardingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<RoleOnboardingView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<RoleOnboardingView>("start", orgHint || "_");
      if (!viewRef.current && cached?.data && isStartView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    const qs = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
    try {
      const response = await fetch(`/api/role-onboarding${qs}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(responseError(body) || "Could not load your path.");
        return;
      }
      if (!response.ok || !isStartView(body)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Your path. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(responseError(body) || "Could not load your path.");
        return;
      }
      setView(body);
      setFromCache(false);
      setCachedAt(null);
      setError("");
      await persistStartSnapshot(orgHint, body);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Your path. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setError("Could not load your path.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(body: Record<string, unknown>) {
    if (!orgId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/role-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isStartView(data)) {
        setError(responseError(data) || "Update failed.");
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      await persistStartSnapshot(orgId, data);
    } catch {
      setError("Update failed.");
    } finally {
      setBusy(false);
    }
  }

  const failure =
    !view && fetchFailed
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
            message: error,
          },
        )
      : null;

  if (!view) {
    return (
      <main className="module-page start-page">
        <PageHeader navPath="/start" title="Your path" description={failure?.title ?? "Checking your path."}>
          <StartRelated orgId={orgId} />
        </PageHeader>
        <TeamOpsNav orgId={orgId} active="start" />
        <OfflineBanner feature="Your path" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Your path"}
          description={failure ? failure.description : "Checking your path."}
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
        <main className="module-page start-page">
          <PageHeader
            navPath="/start"
            title="Your path"
            description={view.message || "Choose your team to open your path."}
          >
            <StartRelated orgId={orgId} />
          </PageHeader>
          <TeamOpsNav orgId={orgId} active="start" />
          <OfflineBanner feature="Your path" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="start-warn" role="status">
              {error}
            </p>
          ) : null}
          <EmptyState
            soft
            badge="Needs setup"
            badgeTone="setup"
            title="Choose your team"
            description="Personal checklists are assigned from your team role, primary focus, and the calendar subteams you join."
          >
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "live": {
      const pct = view.totalCount ? Math.round((view.doneCount / view.totalCount) * 100) : 0;
      const activeTracks = view.tracks.filter((t) => !t.dismissed);
      const dismissedTracks = view.tracks.filter((t) => t.dismissed);
      const nextCheck = activeTracks.flatMap((track) => track.checks).find((check) => !check.done);
      return (
        <main className="module-page start-page">
          <PageHeader
            navPath="/start"
            title="Your path"
            description={`Guided first steps for ${view.orgName} — from role, focus, and your subteams.`}
          >
            <StartRelated orgId={view.orgId} />
          </PageHeader>
          <TeamOpsNav orgId={view.orgId} active="start" />
          <OfflineBanner feature="Your path" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="start-warn" role="status">
              {error}
            </p>
          ) : null}
          <p className="start-meta" role="status">
            {[
              view.teamRole ? `Role: ${view.teamRole}` : null,
              view.crewRole ? `Crew: ${view.crewRole}` : null,
              view.roleDescription ? view.roleDescription : null,
              view.primaryFocus ? `Focus: ${view.primaryFocus}` : null,
              view.subteamNames.length
                ? `Subteams: ${view.subteamNames.join(", ")}`
                : "No calendar subteams yet",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <section className="start-progress" aria-label="Overall progress">
            <strong>
              {view.doneCount}/{view.totalCount} checks · {pct}%
            </strong>
            <div className="start-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
          </section>
          <section className="start-launchpad" aria-labelledby="start-launch-title">
            <div className="start-launch-head">
              <div>
                <span>PERSONAL LAUNCH PLAN</span>
                <h2 id="start-launch-title">Everything you need to become team-ready</h2>
              </div>
              <strong>{pct === 100 ? "Ready" : `${view.totalCount - view.doneCount} steps left`}</strong>
            </div>
            <div className="start-launch-grid">
              <article className="done">
                <b>1</b>
                <div>
                  <strong>Access verified</strong>
                  <span>Your account is connected to this team through a closed membership.</span>
                </div>
              </article>
              <article>
                <b>2</b>
                <div>
                  <strong>{activeTracks.length} paths personalized</strong>
                  <span>Built from your role, focus, and assigned subteams—not a generic tour.</span>
                </div>
              </article>
              <article>
                <b>3</b>
                <div>
                  <strong>{nextCheck?.label ?? "Launch path complete"}</strong>
                  <span>{nextCheck?.detail ?? "You finished every active onboarding check."}</span>
                  {nextCheck?.href ? <a href={nextCheck.href}>Do this next →</a> : null}
                </div>
              </article>
              <article className="security">
                <b>✓</b>
                <div>
                  <strong>Protect your account</strong>
                  <span>Enroll an authenticator and save recovery codes before event day.</span>
                  <a href="/security">Open security →</a>
                </div>
              </article>
            </div>
          </section>
          {activeTracks.map((track) => (
            <TrackCard key={track.key} track={track} busy={busy} onMutate={mutate} />
          ))}
          {dismissedTracks.length > 0 ? (
            <section className="start-empty">
              <p>
                <strong>Dismissed paths</strong> — restore any you still want.
              </p>
              {dismissedTracks.map((track) => (
                <div key={track.key} className="start-actions">
                  <span>{track.title}</span>
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate({ action: "undismiss", trackKey: track.key })}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
          <StartNextActions orgId={view.orgId} />
        </main>
      );
    }
    default: {
      const _never: never = view;
      return _never;
    }
  }
}

function TrackCard({
  track,
  busy,
  onMutate,
}: {
  track: StartTrackView;
  busy: boolean;
  onMutate: (body: Record<string, unknown>) => void;
}) {
  return (
    <section className={`start-track${track.dismissed ? " dismissed" : ""}`}>
      <div className="start-track-head">
        <div>
          <h2>{track.title}</h2>
          <p>{track.summary}</p>
          <p className="start-reason">
            {track.reason} · {track.doneCount}/{track.totalCount} done
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => void onMutate({ action: "dismiss", trackKey: track.key })}
        >
          Dismiss
        </Button>
      </div>
      <ul className="start-checks">
        {track.checks.map((check) => (
          <li key={check.key} className={`start-check${check.done ? " done" : ""}`}>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              aria-pressed={check.done}
              onClick={() =>
                void onMutate({
                  action: check.done ? "uncheck" : "check",
                  trackKey: track.key,
                  checkKey: check.key,
                })
              }
            >
              {check.done ? "✓" : "○"}
            </Button>
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </div>
            {check.href ? <a href={check.href}>Open</a> : <span />}
          </li>
        ))}
      </ul>
    </section>
  );
}
