// Event Readiness — the dated countdown BEFORE an event. The hour-by-hour
// schedule DURING an event lives in lib/event-day-plan and is out of scope here.

export const READINESS_CATEGORIES = [
  "robot",
  "inspection",
  "consent",
  "roster",
  "packing",
  "travel",
  "money",
  "pit",
  "other",
] as const;
export type ReadinessCategory = (typeof READINESS_CATEGORIES)[number];

export const READINESS_STATUSES = ["todo", "in_progress", "done", "blocked", "not_applicable"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export const READINESS_SOURCE_KINDS = [
  "manual",
  "template",
  "inspection",
  "consent",
  "packing",
  "logistics",
] as const;
export type ReadinessSourceKind = (typeof READINESS_SOURCE_KINDS)[number];

/** The four live source systems the roll-up reads (never copies). */
export const ROLLUP_SOURCES = ["inspection", "consent", "packing", "logistics"] as const;
export type RollupSource = (typeof ROLLUP_SOURCES)[number];

/** Deep links to the tool that OWNS each source's data entry. */
export const READINESS_SOURCE_HREFS: Record<RollupSource, string> = {
  inspection: "/inspection",
  consent: "/consent",
  packing: "/packing",
  logistics: "/logistics",
};

export const READINESS_SOURCE_LABELS: Record<RollupSource, string> = {
  inspection: "Inspection",
  consent: "Consent forms",
  packing: "Packing",
  logistics: "Travel & logistics",
};

export function readinessCategoryLabel(category: ReadinessCategory): string {
  const labels: Record<ReadinessCategory, string> = {
    robot: "Robot",
    inspection: "Inspection",
    consent: "Consent",
    roster: "Roster",
    packing: "Packing",
    travel: "Travel",
    money: "Money",
    pit: "Pit",
    other: "Other",
  };
  return labels[category];
}

export function readinessStatusLabel(status: ReadinessStatus): string {
  const labels: Record<ReadinessStatus, string> = {
    todo: "To do",
    in_progress: "In progress",
    done: "Done",
    blocked: "Blocked",
    not_applicable: "N/A",
  };
  return labels[status];
}

export type ReadinessItem = {
  id: string;
  category: ReadinessCategory;
  title: string;
  detail: string;
  dueOn: string | null;
  daysBefore: number | null;
  status: ReadinessStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceKind: ReadinessSourceKind;
  blockedReason: string;
  completedAt: string | null;
};

export type ReadinessPlan = {
  id: string;
  eventKey: string;
  eventName: string;
  eventStartDate: string;
  seasonYear: number | null;
  travelDepartsAt: string | null;
  notes: string;
};
