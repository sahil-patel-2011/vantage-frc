"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { RoleOnboardingView, StartTrackView } from "../../lib/role-onboarding";

export default function StartClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<RoleOnboardingView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/role-onboarding${qs}`);
      const data = (await response.json()) as RoleOnboardingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load your path.");
        setErrorStatus(response.status);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setError("Could not load your path.");
    } finally {
      setLoading(false);
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
      const data = (await response.json()) as RoleOnboardingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Update failed.");
        return;
      }
      setError("");
      setView(data);
    } catch {
      setError("Update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !view) {
    return (
      <main className="module-page start-page">
        <PageHeader navPath="/start" title="Your path" description="Loading onboarding checklists…" />
      </main>
    );
  }

  if (!view && error) {
    const copy = loadFailureCopy(
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
    );
    return (
      <main className="module-page start-page">
        <PageHeader navPath="/start" title="Your path" description={copy.title} />
        <TeamOpsNav orgId={orgId} active="start" />
        <div className="start-empty">
          <p>{copy.description}</p>
          {copy.primary ? (
            <a className="start-btn primary" href={copy.primary.href}>
              {copy.primary.label}
            </a>
          ) : null}
          {copy.showRetry ? (
            <button type="button" className="start-btn primary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  if (!view || view.status === "setup_required") {
    return (
      <main className="module-page start-page">
        <PageHeader
          navPath="/start"
          title="Your path"
          description={view?.message ?? error ?? "Select a team workspace to open your path."}
        />
        <TeamOpsNav orgId={orgId} active="start" />
        <div className="start-empty">
          <p>
            Personal checklists are assigned from your team role, primary focus, and the calendar
            subteams you join — not a wiki wall.
          </p>
          <a className="start-btn primary" href="/workspace">
            Open Workspace
          </a>
        </div>
      </main>
    );
  }

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
        <div className="start-actions">
          <button
            type="button"
            className="start-btn"
            disabled={busy}
            onClick={() => void mutate({ action: "refresh" })}
          >
            Refresh assignment
          </button>
          <a className="start-btn primary" href={withOrgHref("/team/getting-started", view.orgId)}>
            Team setup
          </a>
        </div>
      </PageHeader>

      <TeamOpsNav orgId={view.orgId} active="start" />

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
            <div><strong>Access verified</strong><span>Your account is connected to this team through a closed membership.</span></div>
          </article>
          <article>
            <b>2</b>
            <div><strong>{activeTracks.length} paths personalized</strong><span>Built from your role, focus, and assigned subteams—not a generic tour.</span></div>
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
            <div><strong>Protect your account</strong><span>Enroll an authenticator and save recovery codes before event day.</span><a href="/security">Open security →</a></div>
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
              <button
                type="button"
                className="start-btn"
                disabled={busy}
                onClick={() => void mutate({ action: "undismiss", trackKey: track.key })}
              >
                Restore
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
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
        <button
          type="button"
          className="start-btn"
          disabled={busy}
          onClick={() => void onMutate({ action: "dismiss", trackKey: track.key })}
        >
          Dismiss
        </button>
      </div>
      <ul className="start-checks">
        {track.checks.map((check) => (
          <li key={check.key} className={`start-check${check.done ? " done" : ""}`}>
            <button
              type="button"
              className="start-btn"
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
            </button>
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </div>
            {check.href ? <a href={check.href} aria-label={`Open ${check.label}`}>Open</a> : <span />}
          </li>
        ))}
      </ul>
    </section>
  );
}
