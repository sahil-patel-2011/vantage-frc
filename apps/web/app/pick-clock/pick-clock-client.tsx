"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CompetitionHubRelated } from "../../components/competition-hub-related";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  strategySetupNextActions,
} from "../../lib/strategy/competition-related";
import {
  clockRemaining,
  clockUrgency,
  PICK_CLOCK_SECONDS,
  type PickClockRecommendation,
} from "../../lib/strategy/pick-clock";

type PickClockView =
  | {
      status: "ready";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      pickListId: string | null;
      pickListName: string | null;
      sources: string[];
      pickMode: "full" | "low_data_tba";
      pickModeReason: string | null;
      scoutedTeams: number;
      teamCount: number;
      epaDrifts: Array<{ teamKey: string; label: string; delta: number }>;
      excludedTeamKeys: string[];
      recommendation: PickClockRecommendation | null;
      alternates: PickClockRecommendation[];
      availableCount: number;
      excludedCount: number;
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      eventKey: string | null;
    };

function teamDisplay(rec: PickClockRecommendation): string {
  if (rec.teamNumber != null) return String(rec.teamNumber);
  return rec.teamKey.replace(/^frc/i, "") || rec.teamKey;
}

function ReasonList({ reasons }: { reasons: PickClockRecommendation["reasons"] }) {
  if (!reasons.length) return null;
  return (
    <ul className="pck-reasons">
      {reasons.map((reason) => (
        <li key={reason.label} className={`pck-reason ${reason.tone}`}>
          {reason.label}
        </li>
      ))}
    </ul>
  );
}

export default function PickClockClient() {
  const [view, setView] = useState<PickClockView | null>(null);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [skipOffset, setSkipOffset] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(
        `/api/strategy/pick-clock${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`,
      );
      const data = (await response.json()) as PickClockView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load pick clock.");
        return;
      }
      setError("");
      setView(data);
      setSkipOffset(0);
    } catch {
      setError("Could not reach the pick clock API.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const remaining = clockRemaining(startedAt, now);
  const urgency = clockUrgency(remaining);

  if (!view && !error) {
    return (
      <main className="app-shell-page pck-page">
        <EmptyState title="Loading pick clock…" soft aria-busy />
      </main>
    );
  }

  if (error || !view) {
    return (
      <main className="app-shell-page pck-page">
        <EmptyState title="Pick clock unavailable" description={error || "Unknown error."} badge="Error" badgeTone="">
          <button type="button" className="app-button" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const nextActions = strategySetupNextActions({
      orgId: view.orgId,
      eventKey: view.eventKey,
      hasMetrics: false,
    });
    return (
      <main className="app-shell-page pck-page">
        <PageHeader
          navPath="/pick-clock"
          title="Pick Clock"
          description="Next best pick + why — built for the 45-second alliance selection timer. Never invents EPA."
        />
        <EmptyState
          title="Setup needed"
          description={view.message}
          badge="Setup"
          badgeTone="setup"
        >
          <ol className="strategy-setup-steps pck-setup-steps">
            {nextActions.slice(0, 5).map((action) => (
              <li key={action.id}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a href={action.href}>Open</a>
              </li>
            ))}
          </ol>
          <CompetitionHubRelated
            orgId={view.orgId}
            active="pick-clock"
            include={["strategy", "scouting", "forms", "match-checklist", "draft", "chemistry"]}
          />
        </EmptyState>
      </main>
    );
  }

  const queue = view.recommendation
    ? [view.recommendation, ...view.alternates]
    : [];
  const active = queue[Math.min(skipOffset, Math.max(0, queue.length - 1))] ?? null;
  const orgQs = `?orgId=${encodeURIComponent(view.orgId)}`;
  const nextActions = strategySetupNextActions({
    orgId: view.orgId,
    eventKey: view.eventKey,
    tbaConfigured: true,
    hasMetrics: true,
  }).filter((action) => ["scouting", "forms", "checklist", "coverage"].includes(action.id));

  return (
    <main className="app-shell-page pck-page">
      <PageHeader
        navPath="/pick-clock"
        title="Pick Clock"
        description={
          view.eventName
            ? `${view.eventName} · ${PICK_CLOCK_SECONDS}s selection clock`
            : `${PICK_CLOCK_SECONDS}-second alliance pick assistant`
        }
      >
        <div className="pck-header-actions">
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Refresh
          </button>
          <Link className="app-button secondary" href={`/strategy?tab=picks&orgId=${encodeURIComponent(view.orgId)}`}>
            Pick desk
          </Link>
          <Link className="app-button secondary" href={`/strategy/draft${orgQs}`}>
            Draft board
          </Link>
        </div>
      </PageHeader>

      <CompetitionHubRelated
        orgId={view.orgId}
        active="pick-clock"
        include={["strategy", "scouting", "forms", "match-checklist", "chemistry", "draft", "coverage"]}
      />

      {view.pickMode === "low_data_tba" ? (
        <p className="pck-mode-banner" role="status">
          <span className="app-badge setup">Low-data TBA</span>
          {view.pickModeReason ?? "Ranking from TBA/Statbotics until scouting coverage improves."}
        </p>
      ) : null}

      <div className={`pck-clock pck-${urgency}`} aria-live="polite">
        <span className="pck-clock-label">{remaining == null ? "Ready" : "Seconds left"}</span>
        <strong className="pck-clock-value">{remaining == null ? PICK_CLOCK_SECONDS : remaining}</strong>
        <div className="pck-clock-actions">
          {startedAt == null ? (
            <button type="button" className="app-button" onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
              Start {PICK_CLOCK_SECONDS}s
            </button>
          ) : (
            <button
              type="button"
              className="app-button secondary"
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
              }}
            >
              Reset clock
            </button>
          )}
        </div>
      </div>

      {!active ? (
        <EmptyState
          title="No teams left to recommend"
          description={
            view.excludedCount
              ? `${view.excludedCount} already taken on the draft board. Clear slots or refresh after updates.`
              : "Load event metrics or build a pick list on Strategy first — no invented rankings."
          }
          badge="Empty"
        >
          <div className="pck-setup-links">
            <Link className="app-button" href={`/strategy?tab=picks&orgId=${encodeURIComponent(view.orgId)}`}>
              Pick desk
            </Link>
            <Link className="app-button secondary" href={`/strategy/draft${orgQs}`}>
              Draft board
            </Link>
          </div>
        </EmptyState>
      ) : (
        <section className="pck-hero soft-panel" aria-label="Next best pick">
          <p className="pck-eyebrow">
            Next pick
            {view.pickListName ? ` · ${view.pickListName}` : ""}
            {view.availableCount ? ` · ${view.availableCount} available` : ""}
            {view.scoutedTeams != null && view.teamCount
              ? ` · ${view.scoutedTeams}/${view.teamCount} scouted`
              : ""}
          </p>
          <h2 className="pck-team-number">{teamDisplay(active)}</h2>
          {active.nickname ? <p className="pck-nickname">{active.nickname}</p> : null}
          <p className="pck-headline">{active.headline}</p>
          {active.epaDrift?.divergent ? (
            <p className="pck-drift" role="status">
              {active.epaDrift.label}
            </p>
          ) : null}
          <ReasonList reasons={active.reasons} />

          <div className="pck-tools">
            <button
              type="button"
              className="app-button secondary"
              disabled={queue.length < 2}
              onClick={() => setSkipOffset((n) => (n + 1) % queue.length)}
            >
              Show alternate
            </button>
            <Link
              className="app-button secondary"
              href={`/dossier${orgQs}&team=${encodeURIComponent(active.teamNumber != null ? String(active.teamNumber) : active.teamKey.replace(/^frc/i, ""))}`}
            >
              Dossier
            </Link>
            <Link className="app-button secondary" href={`/chemistry${orgQs}&teams=${encodeURIComponent(teamDisplay(active))}`}>
              Chemistry
            </Link>
          </div>
        </section>
      )}

      {queue.length > 1 ? (
        <section className="pck-alts" aria-label="Quick alternates">
          <h3>Also ready</h3>
          <ul>
            {queue
              .filter((_, index) => index !== Math.min(skipOffset, queue.length - 1))
              .map((alt) => (
                <li key={alt.teamKey}>
                  <button
                    type="button"
                    onClick={() => setSkipOffset(queue.findIndex((row) => row.teamKey === alt.teamKey))}
                  >
                    <strong>{teamDisplay(alt)}</strong>
                    <span>{alt.headline}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="pck-next-actions soft-panel" aria-label="Deepen pick explainability">
        <h3>Next actions</h3>
        <p className="app-muted">
          Strengthen “why” lines with real scout depth — never DEMO metrics.
        </p>
        <ul className="pck-next-list">
          {nextActions.map((action) => (
            <li key={action.id}>
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <a className="app-button secondary" href={action.href}>
                Open
              </a>
            </li>
          ))}
        </ul>
      </section>

      {view.sources.length ? (
        <p className="pck-sources app-muted">
          Signals: {view.sources.join(" · ")}
          {view.pickMode === "low_data_tba" ? " · quick-pick mode" : " · pick-desk scoring"}
          {view.epaDrifts.length ? ` · ${view.epaDrifts.length} EPA-drift callout${view.epaDrifts.length === 1 ? "" : "s"}` : ""}
        </p>
      ) : null}
    </main>
  );
}
