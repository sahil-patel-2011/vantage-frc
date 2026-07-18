"use client";

import { useCallback, useEffect, useState } from "react";
import { CompetitionHubRelated } from "../../components/competition-hub-related";
import { PageHeader } from "../../components/ui/page-header";
import type { MyDayMatch, MyDayView } from "../../lib/my-day";
import { hubHref } from "../../lib/nav/hubs";

const POLL_MS = 45_000;

function ScoutChips({
  label,
  chips,
}: {
  label: string;
  chips: Array<{ teamKey: string; teamNumber: string; href: string }>;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="myday-chip-row">
      <span className="myday-chip-label">{label}</span>
      <ul className="myday-chips">
        {chips.map((chip) => (
          <li key={chip.teamKey}>
            <a className="myday-chip" href={chip.href}>
              {chip.teamNumber}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchHero({ match, orgId }: { match: MyDayMatch; orgId?: string | null }) {
  return (
    <section className={`myday-hero alliance-${match.alliance}`} aria-live="polite">
      <p className="myday-hero-kicker">Next match</p>
      <h2 className="myday-hero-title">{match.matchLabel}</h2>
      <p className="myday-hero-time">{match.timeLabel}</p>
      <p className={`myday-bumper alliance-${match.alliance}`}>{match.bumperCue}</p>
      <ScoutChips label="With" chips={match.links.scoutPartners} />
      <ScoutChips label="Vs" chips={match.links.scoutOpponents} />
      <nav className="myday-hero-links" aria-label="Match links">
        <a className="myday-link primary" href={match.links.command}>
          Event Day Command
        </a>
        <a className="myday-link" href={hubHref("/competition", "strategy", orgId)}>
          Strategy
        </a>
        <a className="myday-link" href={hubHref("/competition", "scouting", orgId)}>
          Scouting
        </a>
        <a className="myday-link" href={match.links.briefing}>
          Briefing
        </a>
        <a className="myday-link" href={match.links.checklist}>
          Checklist
        </a>
        <a className="myday-link" href={match.links.schedule}>
          Full schedule
        </a>
      </nav>
    </section>
  );
}

function MatchCard({ match }: { match: MyDayMatch }) {
  return (
    <li className={`myday-card alliance-${match.alliance}${match.isNext ? " next" : ""}`}>
      <div className="myday-card-top">
        <strong>{match.matchLabel}</strong>
        <span>{match.timeLabel}</span>
      </div>
      <p className={`myday-bumper sm alliance-${match.alliance}`}>{match.bumperCue}</p>
      <ScoutChips label="With" chips={match.links.scoutPartners} />
      <ScoutChips label="Vs" chips={match.links.scoutOpponents} />
      {match.scored ? (
        <p className="myday-score">
          {match.redScore} – {match.blueScore}
        </p>
      ) : null}
    </li>
  );
}

export default function MyDayClient() {
  const [view, setView] = useState<MyDayView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    try {
      const response = await fetch(`/api/my-day${qs}`);
      const data = (await response.json()) as MyDayView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load My Day.");
        return;
      }
      setError("");
      setView(data);
    } catch {
      setError("Could not load My Day.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && !view) {
    return (
      <main className="module-page myday-page">
        <PageHeader navPath="/my-day" title="My Day" description="Loading your match schedule…" />
      </main>
    );
  }

  if (error && !view) {
    return (
      <main className="module-page myday-page">
        <PageHeader navPath="/my-day" title="My Day" description={error} />
        <button type="button" className="myday-link primary" onClick={() => void load()}>
          Retry
        </button>
      </main>
    );
  }

  if (!view || view.status === "setup_required") {
    return (
      <main className="module-page myday-page">
        <PageHeader
          navPath="/my-day"
          title="My Day"
          description={view?.message ?? "Select a team workspace to open My Day."}
        />
        <CompetitionHubRelated
          orgId={view?.context.orgId ?? null}
          active="my-day"
          include={["command", "strategy", "scouting", "match-checklist"]}
        />
        <div className="myday-empty soft-panel">
          <span className="app-badge setup">Setup required</span>
          <p>
            My Day fills in once your active event schedule is synced. Set the event and team number
            in Workspace, then pull TBA data from Team → Data. No demo match times.
          </p>
          <a className="myday-link primary" href="/workspace">
            Open Workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId;
  const emptySchedule = view.emptyReason === "no_schedule" || view.freshness.matchCount === 0;
  const noOurMatches = !emptySchedule && view.matches.length === 0;

  return (
    <main className="module-page myday-page">
      <PageHeader
        navPath="/my-day"
        title="My Day"
        description={
          view.context.eventName
            ? `${view.context.eventName}${view.context.teamNumber != null ? ` · Team ${view.context.teamNumber}` : ""}`
            : "Your matches at the active event."
        }
      />

      <CompetitionHubRelated
        orgId={orgId}
        active="my-day"
        include={["command", "strategy", "scouting", "match-checklist"]}
      />

      <p className="myday-freshness" role="status">
        {view.freshness.label}
        {view.freshness.ourMatchCount > 0
          ? ` · ${view.freshness.ourMatchCount} of our matches`
          : null}
      </p>

      {error ? (
        <p className="myday-warn" role="status">
          {error} Showing last good load.
        </p>
      ) : null}

      {emptySchedule ? (
        <div className="myday-empty soft-panel">
          <p>No match schedule for this event yet. Sync TBA from Team → Data after the event posts.</p>
          {orgId ? (
            <a className="myday-link primary" href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>
              Team data
            </a>
          ) : null}
        </div>
      ) : null}

      {noOurMatches ? (
        <div className="myday-empty soft-panel">
          <p>Schedule is in, but your team is not on any matches yet. Check back after alliances post.</p>
        </div>
      ) : null}

      {view.next ? <MatchHero match={view.next} orgId={orgId} /> : null}

      {view.matches.length > 0 ? (
        <section className="myday-list-section">
          <h2>Our matches</h2>
          <ul className="myday-list">
            {view.matches.map((match) => (
              <MatchCard key={match.matchKey} match={match} />
            ))}
          </ul>
        </section>
      ) : null}

      {!view.next && view.matches.length > 0 && orgId ? (
        <nav className="myday-hero-links" aria-label="Competition links">
          <a className="myday-link primary" href={hubHref("/competition", "command", orgId)}>
            Event Day Command
          </a>
          <a className="myday-link" href={hubHref("/competition", "strategy", orgId)}>
            Strategy
          </a>
          <a className="myday-link" href={hubHref("/competition", "scouting", orgId)}>
            Scouting
          </a>
          <a className="myday-link" href={`/schedule?orgId=${encodeURIComponent(orgId)}`}>
            Full schedule
          </a>
        </nav>
      ) : null}
    </main>
  );
}
