"use client";

import { useState, useMemo } from "react";

/**
 * Scouting filter bar — lets the user sort dashboard scouting metrics
 * by date range and team member. Pure client-side state that re-derives
 * the displayed numbers.
 */

export type ScoutingFilter = {
  dateRange: "today" | "week" | "event" | "all";
  member: string;
};

export type ScoutingData = {
  assignments: number;
  reports: number;
  openDisagreements: number;
};

const DATE_LABELS: Record<ScoutingFilter["dateRange"], string> = {
  today: "Today",
  week: "This Week",
  event: "Event",
  all: "All Time",
};

// Multiplier simulates per-period scoping on the raw totals.
const DATE_SCALE: Record<ScoutingFilter["dateRange"], number> = {
  today: 0.12,
  week: 0.45,
  event: 1,
  all: 1.2,
};

const TEAM_MEMBERS = [
  "All Members",
  "Alex K.",
  "Jordan M.",
  "Sam R.",
  "Taylor P.",
  "Casey L.",
];

const MEMBER_SCALE: Record<string, number> = {
  "All Members": 1,
  "Alex K.": 0.32,
  "Jordan M.": 0.28,
  "Sam R.": 0.22,
  "Taylor P.": 0.12,
  "Casey L.": 0.06,
};

export function ScoutingFilterBar({
  data,
  children,
}: {
  data: ScoutingData;
  children: (filtered: ScoutingData, filter: ScoutingFilter) => React.ReactNode;
}) {
  const [dateRange, setDateRange] = useState<ScoutingFilter["dateRange"]>("event");
  const [member, setMember] = useState("All Members");

  const filtered = useMemo<ScoutingData>(() => {
    const scale = DATE_SCALE[dateRange] * MEMBER_SCALE[member];
    return {
      assignments: Math.round(data.assignments * scale),
      reports: Math.round(data.reports * scale),
      openDisagreements: Math.round(data.openDisagreements * scale),
    };
  }, [data, dateRange, member]);

  return (
    <div>
      <div className="vt-scout-filter" role="toolbar" aria-label="Filter scouting metrics">
        <div className="vt-scout-filter-group">
          <span className="vt-scout-filter-label">Date</span>
          <div className="vt-scout-filter-pills">
            {(Object.keys(DATE_LABELS) as ScoutingFilter["dateRange"][]).map((key) => (
              <button
                key={key}
                className="vt-scout-pill"
                data-active={dateRange === key}
                onClick={() => setDateRange(key)}
              >
                {DATE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="vt-scout-filter-group">
          <span className="vt-scout-filter-label">Member</span>
          <select
            className="vt-scout-select"
            value={member}
            onChange={(e) => setMember(e.target.value)}
            aria-label="Filter by team member"
          >
            {TEAM_MEMBERS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      {children(filtered, { dateRange, member })}
    </div>
  );
}
