import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { TRAVEL_LEG_LABELS, type TravelLegKind } from "../logistics";

/** Soft-UI related Event Day / Team surfaces for logistics travel. */
export const LOGISTICS_RELATED_LINKS = [
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "my-day", label: "My Day", kind: "competition" as const, tab: "my-day" },
  { id: "calendar", label: "Team calendar", kind: "path" as const, path: "/team/calendar?tab=trip" },
  { id: "packing", label: "Packing", kind: "path" as const, path: "/packing" },
  { id: "visit-invites", label: "Visit invites", kind: "path" as const, path: "/visit-invites" },
] as const;

export type LogisticsRelatedId = (typeof LOGISTICS_RELATED_LINKS)[number]["id"];

export type LogisticsRelatedLink = {
  id: LogisticsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Event Day · My Day · Calendar · Packing · Visit invites. */
export const LOGISTICS_RELATED_INCLUDE: LogisticsRelatedId[] = [
  "command",
  "my-day",
  "calendar",
  "packing",
  "visit-invites",
];

/** Cross-links for Logistics Soft-UI (never DEMO lodging / schedule). */
export function logisticsRelatedLinks(
  orgId?: string | null,
  options?: { active?: LogisticsRelatedId; include?: LogisticsRelatedId[] },
): LogisticsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return LOGISTICS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type LogisticsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type LogisticsShellNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type LogisticsEmptyCopy = {
  kind: LogisticsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO lodging. */
export type LogisticsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function logisticsSetupSteps(orgId?: string | null): LogisticsSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Logistics.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "trip",
      label: "Add a trip",
      detail: "Publish leave, hotel, venue, and return times.",
      href: withOrgHref("/logistics", orgId),
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Field-side Command shares the same travel strip once a trip exists.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "calendar",
      label: "Open Team calendar",
      detail: "Travel legs sync as trip blocks when mentors enable calendar sync.",
      href: withOrgHref("/team/calendar?tab=trip", orgId),
    },
  ];
}

/** Classify Logistics Soft-UI shell — never invents DEMO lodging. */
export function classifyLogisticsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  tripCount?: number;
}): LogisticsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && input.status == null) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status !== "ready") return "error";
  if ((input.tripCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO lodging or travel times. */
export function logisticsShellCopy(kind: LogisticsShellKind): LogisticsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Logistics…",
        description: "Checking which team you are on and published trips.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Logistics",
        description:
          "A network or server issue blocked hotels and travel. Retry, or open Event Day / My Day / Calendar while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Finish setup for travel plans",
        description:
          "Choose your team and apply the event logistics migration if tables are missing.",
      };
    case "empty":
      return {
        kind,
        badge: "No trips yet",
        title: "Travel plan not published",
        description:
          "Mentors add a trip with hotels, rooming, and leave/arrive times. Empty means nothing is booked yet.",
      };
    default:
      return {
        kind,
        title: "Logistics",
        description: "Hotels, rooming, travel legs, and day-of checklists from real trip rows.",
      };
  }
}

function dropRelatedStripDuplicates(
  orgId: string | null | undefined,
  actions: LogisticsShellNextAction[],
): LogisticsShellNextAction[] {
  const relatedHrefs = new Set(
    logisticsRelatedLinks(orgId, { include: [...LOGISTICS_RELATED_INCLUDE] }).map((link) => link.href),
  );
  return actions.filter((action) => !relatedHrefs.has(action.href));
}

/**
 * Soft-UI next actions for Logistics empty/setup shells.
 * Points at real Event Day / My Day / Calendar / Visit invites — never DEMO lodging.
 * Destinations already in the header related strip are omitted so each href
 * appears once on the page.
 */
export function logisticsShellNextActions(input: {
  orgId?: string | null;
  shell: LogisticsShellKind;
  canManage?: boolean;
  lodgingGaps?: number;
  travelLegCount?: number;
  hotelCount?: number;
}): LogisticsShellNextAction[] {
  return dropRelatedStripDuplicates(input.orgId, logisticsShellNextActionCandidates(input));
}

function logisticsShellNextActionCandidates(input: {
  orgId?: string | null;
  shell: LogisticsShellKind;
  canManage?: boolean;
  lodgingGaps?: number;
  travelLegCount?: number;
  hotelCount?: number;
}): LogisticsShellNextAction[] {
  const orgId = input.orgId ?? null;
  const canManage = Boolean(input.canManage);

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before publishing hotels.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Field command stays blank until a team and trip exist.",
          href: hubHref("/competition", "command", null),
        },
        {
          id: "my-day",
          label: "Open My Day",
          detail: "Personal lodging and leave times appear after mentors publish a trip.",
          href: hubHref("/competition", "my-day", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership or migration setup so Logistics can resolve your org.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Competition day-of tools stay separate until travel is published here.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "visit-invites",
        label: "Open Visit invites",
        detail: "Shop tours and guest days live next door — not the same as event lodging.",
        href: withOrgHref("/visit-invites", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Logistics",
        detail: "Reload real hotels and travel legs.",
        href: withOrgHref("/logistics", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Match queue may still load if this travel board failed.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal bumper and travel strip may still resolve from cache.",
        href: hubHref("/competition", "my-day", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    if (canManage) {
      return [
        {
          id: "create",
          label: "Add the first trip",
          detail: "Use the form on this page — hotels and leave times stay blank until you publish them.",
          href: withOrgHref("/logistics", orgId) + "#logistics-create-trip",
          primary: true,
        },
        {
          id: "calendar",
          label: "Open Team calendar",
          detail: "Trip blocks appear after travel legs sync.",
          href: withOrgHref("/team/calendar?tab=trip", orgId),
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Field command shows lodging once a trip and rooming list exist.",
          href: hubHref("/competition", "command", orgId),
        },
        {
          id: "visit-invites",
          label: "Open Visit invites",
          detail: "Shop tours stay separate from competition lodging.",
          href: withOrgHref("/visit-invites", orgId),
        },
      ].slice(0, 4);
    }
    return [
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal lodging stays blank until mentors publish a trip.",
        href: hubHref("/competition", "my-day", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Match times load from TBA even when travel is not published yet.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "calendar",
        label: "Open Team calendar",
        detail: "Practice and outreach nights stay on Calendar while event travel is empty.",
        href: withOrgHref("/team/calendar?tab=trip", orgId),
      },
    ];
  }

  const actions: LogisticsShellNextAction[] = [];
  if ((input.lodgingGaps ?? 0) > 0 && canManage) {
    actions.push({
      id: "lodging",
      label: `Fill ${input.lodgingGaps} lodging gap${input.lodgingGaps === 1 ? "" : "s"}`,
      detail: "Assign occupants on hotel room rows — students see their room only when listed.",
      href: withOrgHref("/logistics", orgId),
      primary: true,
    });
  }
  if ((input.hotelCount ?? 0) === 0 && canManage) {
    actions.push({
      id: "hotel",
      label: "Add a hotel",
      detail: "Name, address, and rooming list so students get a clear room assignment.",
      href: withOrgHref("/logistics", orgId),
      primary: actions.length === 0,
    });
  }
  if ((input.travelLegCount ?? 0) === 0 && canManage) {
    actions.push({
      id: "legs",
      label: "Publish travel times",
      detail: "Leave home, arrive hotel, leave for venue.",
      href: withOrgHref("/logistics", orgId),
      primary: actions.length === 0,
    });
  }

  actions.push({
    id: "command",
    label: "Open Event Day",
    detail: "Match queue and travel strip share this trip once lodging is published.",
    href: hubHref("/competition", "command", orgId),
    primary: actions.length === 0,
  });
  actions.push({
    id: "my-day",
    label: "Open My Day",
    detail: "Personal hotel room and next leave time for day-of ops.",
    href: hubHref("/competition", "my-day", orgId),
  });
  if (actions.length < 4) {
    actions.push({
      id: "calendar",
      label: "Open Team calendar",
      detail: "Synced travel legs show as trip blocks next to practice nights.",
      href: withOrgHref("/team/calendar?tab=trip", orgId),
    });
  }
  return actions.slice(0, 4);
}

/** Student-facing lodging line — real hotel/room only; never DEMO rooms. */
export function formatLodgingClarity(input: {
  hotelName?: string | null;
  roomLabel?: string | null;
  address?: string | null;
}): string | null {
  const hotel = input.hotelName?.trim() || null;
  const room = input.roomLabel?.trim() || null;
  if (!hotel && !room) return null;
  if (hotel && room) return `${hotel} · Room ${room}`;
  if (hotel) return hotel;
  return `Room ${room}`;
}

/** Travel leg clarity for Soft-UI strips — kind label + when + meeting point. */
export function formatTravelLegClarity(input: {
  kind?: TravelLegKind | string | null;
  title?: string | null;
  startsAt?: string | null;
  meetingPoint?: string | null;
  formatWhen?: (iso: string) => string | null;
}): string | null {
  const kind =
    input.kind && input.kind in TRAVEL_LEG_LABELS
      ? TRAVEL_LEG_LABELS[input.kind as TravelLegKind]
      : null;
  const title = input.title?.trim() || null;
  const when =
    input.startsAt && input.formatWhen
      ? input.formatWhen(input.startsAt)
      : input.startsAt
        ? input.startsAt
        : null;
  const meet = input.meetingPoint?.trim() || null;
  const parts = [kind ?? title, when, meet].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
