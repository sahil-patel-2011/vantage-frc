"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { FEATURE_API_TIMEOUT_MS, fetchActiveOrgId, persistOrgIdInUrl } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { RoleOnboardingView, StartTrackView } from "../../lib/role-onboarding";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { withWaitlistLink } from "../../components/waitlist-link";

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
      <a href={withOrgHref("/team/getting-started", orgId)}>Team setup</a>
      <a href={withOrgHref("/team/calendar", orgId)}>Calendar</a>
      <a href="/security">Security</a>
    </nav>
  );
}

export default function StartClient({ orgId: orgIdProp }: { orgId: string | null }) {
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(orgIdProp?.trim() || null);
  const [orgReady, setOrgReady] = useState(Boolean(orgIdProp?.trim()));
  const orgId = resolvedOrgId;
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
    const fromProp = orgIdProp?.trim() || null;
    if (fromProp) {
      setResolvedOrgId(fromProp);
      setOrgReady(true);
      return;
    }
    let cancelled = false;
    setOrgReady(false);
    void fetchActiveOrgId().then((fromMe) => {
      if (cancelled) return;
      setResolvedOrgId(fromMe);
      if (fromMe) persistOrgIdInUrl(fromMe);
      setOrgReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [orgIdProp]);

  useEffect(() => {
    if (!orgReady) return;
    void load();
  }, [load, orgReady]);

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
        <PageHeader navPath="/start" title="Your path" description={failure?.title ?? "Loading onboarding checklists…"}>
          <StartRelated orgId={orgId} />
        </PageHeader>
        <TeamOpsNav orgId={orgId} active="start" />
        <OfflineBanner feature="Your path" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading…"}
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
            description={withWaitlistLink(view.message || "Choose your team to open your path, or join the waitlist.")}
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
            description="Personal checklists are assigned from your team role, primary focus, and the calendar subteams you join. Choose your team, or join the waitlist."
            className="start-setup"
          >
            <div className="start-setup-actions">
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
              <a className="start-setup-waitlist" href="/#waitlist">
                Join the waitlist
              </a>
            </div>
          </EmptyState>
        </main>
      );
    case "live": {
      const activeTracks = view.tracks.filter((t) => !t.dismissed);
      const dismissedTracks = view.tracks.filter((t) => t.dismissed);
      // While the team is being set up, the four setup steps are the page, with the same count
      // Home shows ("0 of 4 done"). Role and focus ideas wait below, folded, instead of turning
      // four steps into sixteen.
      const setup = activeTracks.find((track) => track.key === "team_setup" && track.doneCount < track.totalCount);
      const mainTracks = setup ? [setup] : activeTracks;
      const moreTracks = setup ? activeTracks.filter((track) => track !== setup) : [];
      const doneCount = setup ? setup.doneCount : view.doneCount;
      const totalCount = setup ? setup.totalCount : view.totalCount;
      const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
      const nextCheck = mainTracks.flatMap((track) => track.checks).find((check) => !check.done);
      const meta = [
        view.teamRole ? `Role: ${sentenceCase(view.teamRole)}` : null,
        view.crewRole ? `Crew: ${sentenceCase(view.crewRole)}` : null,
        view.roleDescription ? view.roleDescription : null,
        view.primaryFocus ? `Focus: ${sentenceCase(view.primaryFocus)}` : null,
        view.subteamNames.length ? `Subteams: ${view.subteamNames.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <main className="module-page start-page">
          <PageHeader
            navPath="/start"
            title={setup ? "Set up your team" : "Your path"}
            description={
              setup
                ? `Four steps that get ${view.orgName} going for everyone else.`
                : `First steps for ${view.orgName}, picked from your role and subteams.`
            }
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
          {/* Someone with no role, focus or subteam yet got an empty bordered bar here. */}
          {meta ? <p className="start-meta">{meta}</p> : null}
          <section className="start-progress" aria-label="Overall progress">
            <strong>
              {pct === 100 ? "All done" : `${doneCount} of ${totalCount} done`}
            </strong>
            <div className="start-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            {nextCheck?.href ? (
              <a className="start-next" href={nextCheck.href}>
                Next: {nextCheck.label} →
              </a>
            ) : null}
          </section>
          {mainTracks.map((track) => (
            <TrackCard key={track.key} track={track} busy={busy} onMutate={mutate} />
          ))}
          {moreTracks.length > 0 ? (
            <details className="start-more">
              <summary>More ideas for your role ({moreTracks.length})</summary>
              <p className="start-more-note">Optional. Come back to these once the team is set up.</p>
              {moreTracks.map((track) => (
                <TrackCard key={track.key} track={track} busy={busy} onMutate={mutate} />
              ))}
            </details>
          ) : null}
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

        </main>
      );
    }
    default: {
      const _never: never = view;
      return _never;
    }
  }
}

/** "coach" → "Coach", "leadership" → "Leadership", "drive_team" → "Drive team". */
function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
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
              aria-label={check.done ? `Mark "${check.label}" not done` : `Mark "${check.label}" done`}
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
            {check.href ? (
              <a href={check.href} aria-label={`Open ${check.label}`}>
                Open
              </a>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
