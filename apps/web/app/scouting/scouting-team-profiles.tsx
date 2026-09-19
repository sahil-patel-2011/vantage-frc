"use client";

import { useEffect, useMemo, useState } from "react";
import { CONSISTENCY_LABEL, type ScoutedTeamProfile } from "@vantage/prediction-strategy";
import { EmptyState, Button } from "../../components/ui";
import { apiErrorMessage, classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import "./scouting-team-profiles.css";

/**
 * What your scouting says, rather than how much of it you have done.
 *
 * Every scouting screen in the product until now answered the second question:
 * coverage, shifts, accuracy, disagreements, data quality. All useful, all
 * about the *process*. A team finishes a weekend of tablets able to say "94%
 * covered" and unable to say which robot to pick, which is the only reason
 * anybody filled a tablet in.
 *
 * The engine for this has existed and been tested for a while and reached no
 * screen. This is that screen: one row per robot, with the number, how much it
 * swings, whether it is getting better, where it sits in the field, and the
 * one sentence a pick-list meeting needs.
 */

type View =
  | { status: "ready"; profiles: ScoutedTeamProfile[]; pickOrder: ScoutedTeamProfile[]; basis: string; thin: number; eventKey: string }
  | { status: "empty" | "needs_formula" | "setup_required"; message: string };

type Sort = "pick" | "average" | "number";

export function ScoutingTeamProfiles({ orgId, eventKey }: { orgId: string; eventKey: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  const [sort, setSort] = useState<Sort>("pick");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ orgId });
        if (eventKey) params.set("eventKey", eventKey);
        const response = await fetch(`/api/scouting/teams?${params}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (!response.ok) {
          const message = (await apiErrorMessage(response)) ?? "Could not load what your scouting says";
          if (!cancelled) setError({ message, status: response.status });
          return;
        }
        const body = (await response.json()) as View;
        if (!cancelled) setView(body);
      } catch {
        if (!cancelled) setError({ message: "Could not load what your scouting says", status: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, eventKey]);

  const rows = useMemo(() => {
    if (!view || view.status !== "ready") return [];
    if (sort === "pick") return view.pickOrder.length ? view.pickOrder : view.profiles;
    const copy = [...view.profiles];
    if (sort === "average") return copy.sort((a, b) => b.shrunkTotal - a.shrunkTotal);
    return copy.sort((a, b) => teamNumber(a.teamKey) - teamNumber(b.teamKey));
  }, [view, sort]);

  if (error) {
    const copy = loadFailureCopy(
      classifyLoadFailure({ status: error.status, message: error.message }),
      { message: error.message, nextPath: "/competition?tab=scouting" },
    );
    return (
      <EmptyState soft badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
        {copy.primary ? (
          <Button as="a" variant="primary" href={copy.primary.href}>
            {copy.primary.label}
          </Button>
        ) : null}
      </EmptyState>
    );
  }

  if (!view) {
    return <EmptyState soft aria-busy badge="Loading" title="Reading your scouting" />;
  }

  if (view.status !== "ready") {
    return (
      <EmptyState
        soft
        badge={view.status === "needs_formula" ? "Needs setup" : "Nothing yet"}
        badgeTone="setup"
        title={view.status === "needs_formula" ? "Tell Vantage what your fields are worth" : "No scouting at this event yet"}
        description={view.message}
      >
        {view.status === "needs_formula" ? (
          <Button as="a" variant="primary" href={`/scouting/forms?orgId=${encodeURIComponent(orgId)}`}>
            Open scouting formulas
          </Button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <section className="stp" aria-label="What your scouting says">
      <header className="stp-head">
        <div>
          <h2>{view.profiles.length} robots watched</h2>
          <p>
            {view.basis === "phase" ? "Points by phase, from your own formulas." : "Points from your own total formula."}
            {view.thin > 0
              ? ` ${view.thin} ${view.thin === 1 ? "robot has" : "robots have"} too few matches to rank yet.`
              : ""}
          </p>
        </div>
        <div className="stp-sort" role="group" aria-label="Sort robots">
          {(
            [
              ["pick", "Pick order"],
              ["average", "Average"],
              ["number", "Team number"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={sort === id ? "is-active" : undefined}
              aria-pressed={sort === id}
              onClick={() => setSort(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <ul className="stp-list">
        {rows.map((profile) => (
          <ProfileRow
            key={profile.teamKey}
            profile={profile}
            expanded={open === profile.teamKey}
            onToggle={() => setOpen((current) => (current === profile.teamKey ? null : profile.teamKey))}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Where a robot sits in the field, in words that mean what they look like.
 *
 * This said "Top {100 - percentile}%", which is arithmetically a correct way
 * to express a rank and reads as praise for everybody: the weakest robot at
 * the event came back "Top 95%", which a student skimming a pick list will
 * read as ninety-fifth percentile. Only the actual top of the field gets a
 * "Top" label; everyone else is described against the field directly.
 */
function rankLabel(percentile: number): string {
  const rounded = Math.round(percentile);
  if (rounded >= 90) return `Top ${Math.max(1, 100 - rounded)}%`;
  if (rounded <= 10) return `Bottom ${Math.max(1, rounded)}%`;
  return `Beats ${rounded}% of the field`;
}

function teamNumber(teamKey: string): number {
  const parsed = Number(teamKey.replace(/^frc/i, ""));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function ProfileRow({
  profile,
  expanded,
  onToggle,
}: {
  profile: ScoutedTeamProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const number = profile.teamKey.replace(/^frc/i, "");
  const consistency = profile.consistency?.consistency ?? "unknown";
  return (
    <li className="stp-row" data-consistency={consistency}>
      <button type="button" className="stp-row-main" aria-expanded={expanded} onClick={onToggle}>
        <span className="stp-team">{number}</span>
        <span className="stp-score">
          <strong>{profile.shrunkTotal.toFixed(1)}</strong>
          <small>per match</small>
        </span>
        <Sparkline series={profile.series} label={`${number}'s scored total, match by match`} />
        <span className="stp-tags">
          <span className="stp-tag" data-kind="consistency">
            {CONSISTENCY_LABEL[consistency]}
          </span>
          {profile.trend && profile.trend.direction !== "flat" ? (
            <span className="stp-tag" data-kind={profile.trend.direction}>
              {profile.trend.direction === "up" ? "Improving" : "Falling off"}
            </span>
          ) : null}
          {profile.disabledRate > 0 ? (
            <span className="stp-tag" data-kind="risk">
              Dead {Math.round(profile.disabledRate * 100)}%
            </span>
          ) : null}
          {profile.percentile != null ? (
            <span className="stp-tag" data-kind={profile.percentile >= 50 ? "rank" : undefined}>
              {rankLabel(profile.percentile)}
            </span>
          ) : null}
        </span>
      </button>
      <p className="stp-headline">{profile.headline}</p>
      {expanded ? (
        <dl className="stp-detail">
          <div>
            <dt>Matches watched</dt>
            <dd>{profile.matches}</dd>
          </div>
          <div>
            <dt>Auto / Teleop / Endgame</dt>
            <dd>
              {profile.meanAuto.toFixed(1)} · {profile.meanTeleop.toFixed(1)} · {profile.meanEndgame.toFixed(1)}
            </dd>
          </div>
          {profile.consistency?.floor != null && profile.consistency.ceiling != null ? (
            <div>
              <dt>Bad day / good day</dt>
              <dd>
                {profile.consistency.floor.toFixed(0)} to {profile.consistency.ceiling.toFixed(0)}
              </dd>
            </div>
          ) : null}
          {profile.climbRate != null ? (
            <div>
              <dt>Climbs</dt>
              <dd>{Math.round(profile.climbRate * 100)}% of matches</dd>
            </div>
          ) : null}
          {profile.defenseRate > 0 ? (
            <div>
              <dt>Plays defense</dt>
              <dd>{Math.round(profile.defenseRate * 100)}% of matches</dd>
            </div>
          ) : null}
          <div>
            <dt>Sample</dt>
            <dd>{profile.sampleNote}</dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
}

/**
 * Match-by-match, as a shape.
 *
 * An average tells you where a robot sits; it cannot tell you that the last
 * three matches were its best three, or that one of them was a zero. Drawn
 * from the same `series` the engine already produces, so the picture and the
 * "improving" tag beside it can never disagree.
 */
function Sparkline({ series, label }: { series: readonly number[]; label: string }) {
  if (series.length < 2) {
    return <span className="stp-spark is-thin">not enough matches</span>;
  }
  const width = 108;
  const height = 26;
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const points = series
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = series[series.length - 1]!;
  const lastX = width;
  const lastY = height - ((last - min) / span) * height;

  return (
    <svg
      className="stp-spark"
      viewBox={`0 -2 ${width + 4} ${height + 4}`}
      role="img"
      aria-label={`${label}: ${series.join(", ")}`}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.2" />
    </svg>
  );
}
