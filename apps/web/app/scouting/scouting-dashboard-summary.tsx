"use client";

/**
 * The band at the top of the scouting dashboard.
 *
 * Five numbers a pick-list meeting opens with, all arithmetic over profiles
 * already on the page — no request, works offline. Deliberately short: a
 * dashboard that answers six questions at once answers none of them first.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
import "./scouting-dashboard-summary.css";

function teamNumber(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export function ScoutingDashboardSummary({ profiles }: { profiles: ScoutedTeamProfile[] }) {
  if (profiles.length === 0) return null;

  const matches = profiles.reduce((sum, profile) => sum + profile.matches, 0);
  const fieldAverage =
    profiles.reduce((sum, profile) => sum + profile.shrunkTotal, 0) / profiles.length;
  const top = profiles.reduce((best, profile) =>
    profile.shrunkTotal > best.shrunkTotal ? profile : best,
  );
  const rising = profiles.filter((profile) => profile.trend?.direction === "up").length;
  const risky = profiles.filter((profile) => profile.disabledRate > 0.1).length;

  const stats: Array<{ label: string; value: string; note: string }> = [
    { label: "Robots watched", value: String(profiles.length), note: `${matches} matches recorded` },
    { label: "Field average", value: fieldAverage.toFixed(1), note: "points per match" },
    { label: "Top robot", value: teamNumber(top.teamKey), note: `${top.shrunkTotal.toFixed(1)} per match` },
    { label: "Improving", value: String(rising), note: "trending up late" },
    { label: "Reliability risk", value: String(risky), note: "broke down in 10%+ of matches" },
  ];

  return (
    <dl className="sds" aria-label="Scouting at a glance">
      {stats.map((stat, index) => (
        <div className="sds-cell" key={stat.label} style={{ animationDelay: `${index * 40}ms` }}>
          <dt>{stat.label}</dt>
          <dd>
            <strong>{stat.value}</strong>
            <span>{stat.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
