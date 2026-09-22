"use client";

import type { ReactNode } from "react";

/**
 * Scouting totals for the dashboard card.
 * Date and member filters used to multiply these numbers by made-up
 * ratios and a fixed list of names. Until reports carry a scout and a
 * time, the card shows the totals it was given.
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

export function ScoutingFilterBar({
  data,
  children,
}: {
  data: ScoutingData;
  children: (filtered: ScoutingData, filter: ScoutingFilter) => ReactNode;
}) {
  return (
    <div>
      <p className="vt-scout-filter-note">Event totals. A per-scout or per-day split needs a time and a name on each report.</p>
      {children(data, { dateRange: "event", member: "All Members" })}
    </div>
  );
}
