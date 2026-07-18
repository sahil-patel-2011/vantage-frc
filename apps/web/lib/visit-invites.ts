/**
 * Come see what we do - shop tours and demo days (framework-free domain).
 * Mentors schedule visits; members RSVP; calendar sync is optional.
 */

export const VISIT_KINDS = ["shop_tour", "demo_day"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  shop_tour: "Shop tour",
  demo_day: "Demo day",
};

export const VISIT_STATUSES = ["draft", "scheduled", "done", "cancelled"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  done: "Done",
  cancelled: "Cancelled",
};

export const RSVP_RESPONSES = ["going", "maybe", "no"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

export type VisitHost = {
  id: string;
  visitId: string;
  userId: string | null;
  hostName: string;
  notes: string;
  createdBy: string;
};

export type VisitDemo = {
  id: string;
  visitId: string;
  userId: string | null;
  studentName: string;
  demoTitle: string;
  notes: string;
  sortOrder: number;
  createdBy: string;
};

export type VisitRsvp = {
  id: string;
  visitId: string;
  userId: string | null;
  guestName: string;
  guestEmail: string;
  partySize: number;
  response: RsvpResponse;
  note: string;
  createdBy: string;
  respondedAt: string;
};

export type VisitInvite = {
  id: string;
  title: string;
  kind: VisitKind;
  startsAt: string;
  endsAt: string | null;
  location: string;
  description: string;
  capacity: number | null;
  status: VisitStatus;
  calendarEventId: string | null;
  createdBy: string;
  createdByName: string | null;
  hosts: VisitHost[];
  demos: VisitDemo[];
  rsvps: VisitRsvp[];
  myRsvp: RsvpResponse | null;
};

export type VisitInvitesView =
  | {
      status: "ready";
      context: {
        orgId: string;
        orgName: string;
        role: string;
        teamRole: string | null;
        userId: string;
        canManage: boolean;
      };
      visits: VisitInvite[];
      upcomingCount: number;
      hostGaps: number;
    }
  | {
      status: "setup_required";
      message: string;
      context: { orgId: string | null; orgName: string | null };
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object payload");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string") throw new Error(label + " is required");
  const trimmed = value.trim();
  if (!trimmed) throw new Error(label + " is required");
  if (trimmed.length > max) throw new Error(label + " is too long");
  return trimmed;
}

function optionalString(value: unknown, max = 2000): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error("Expected a string");
  return value.trim().slice(0, max);
}

function requireUuid(value: unknown, label: string): string {
  const text = requireString(value, label, 64);
  if (!UUID_RE.test(text)) throw new Error(label + " is invalid");
  return text;
}

function optionalUuid(value: unknown): string | null {
  if (value == null || value === "") return null;
  return requireUuid(value, "id");
}

function requireKind(value: unknown): VisitKind {
  const text = requireString(value, "kind", 40);
  if (!(VISIT_KINDS as readonly string[]).includes(text)) {
    throw new Error("kind must be shop_tour or demo_day");
  }
  return text as VisitKind;
}

function requireStatus(value: unknown): VisitStatus {
  const text = requireString(value, "status", 40);
  if (!(VISIT_STATUSES as readonly string[]).includes(text)) {
    throw new Error("status is invalid");
  }
  return text as VisitStatus;
}

function requireResponse(value: unknown): RsvpResponse {
  const text = requireString(value, "response", 20);
  if (!(RSVP_RESPONSES as readonly string[]).includes(text)) {
    throw new Error("response must be going, maybe, or no");
  }
  return text as RsvpResponse;
}

function optionalCapacity(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error("capacity must be 1-500");
  return Math.floor(n);
}

function requirePartySize(value: unknown): number {
  if (value == null || value === "") return 1;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 50) throw new Error("partySize must be 1-50");
  return Math.floor(n);
}

/** Owners/admins plus mentor/coach team roles can schedule visits. */
export function canManageVisits(input: {
  role?: string | null;
  teamRole?: string | null;
}): boolean {
  const role = (input.role ?? "").toLowerCase();
  const teamRole = (input.teamRole ?? "").toLowerCase();
  if (role === "owner" || role === "admin") return true;
  return teamRole === "mentor" || teamRole === "coach";
}

export type RsvpCounts = {
  going: number;
  maybe: number;
  no: number;
  partyGoing: number;
};

export function rsvpCounts(
  rsvps: Array<Pick<VisitRsvp, "response" | "partySize">>,
): RsvpCounts {
  let going = 0;
  let maybe = 0;
  let no = 0;
  let partyGoing = 0;
  for (const row of rsvps) {
    if (row.response === "going") {
      going += 1;
      partyGoing += Math.max(1, row.partySize || 1);
    } else if (row.response === "maybe") maybe += 1;
    else if (row.response === "no") no += 1;
  }
  return { going, maybe, no, partyGoing };
}

export type CapacityTone = "open" | "ok" | "near" | "full";

/** Soft capacity signal from going party size vs optional capacity. */
export function capacityTone(partyGoing: number, capacity: number | null): CapacityTone {
  if (capacity == null || capacity <= 0) return "open";
  if (partyGoing >= capacity) return "full";
  if (partyGoing / capacity >= 0.8) return "near";
  return "ok";
}

export function visitNeedsHost(
  visit: Pick<VisitInvite, "hosts" | "status">,
): boolean {
  if (visit.status === "cancelled" || visit.status === "done") return false;
  return visit.hosts.length === 0;
}

export function countHostGaps(visits: Array<Pick<VisitInvite, "hosts" | "status">>): number {
  return visits.filter(visitNeedsHost).length;
}

export function demoDayNeedsStudentDemo(
  visit: Pick<VisitInvite, "kind" | "demos" | "status">,
): boolean {
  if (visit.kind !== "demo_day") return false;
  if (visit.status === "cancelled" || visit.status === "done") return false;
  return visit.demos.length === 0;
}

export function sortVisits(visits: VisitInvite[]): VisitInvite[] {
  return [...visits].sort((a, b) => {
    const statusRank = (s: VisitStatus) =>
      s === "scheduled" ? 0 : s === "draft" ? 1 : s === "done" ? 2 : 3;
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return a.startsAt.localeCompare(b.startsAt);
  });
}

export function upcomingVisitCount(
  visits: Array<Pick<VisitInvite, "startsAt" | "status">>,
  now: Date = new Date(),
): number {
  const t = now.getTime();
  return visits.filter(
    (v) =>
      (v.status === "scheduled" || v.status === "draft") &&
      new Date(v.startsAt).getTime() >= t,
  ).length;
}

export function calendarTitleForVisit(
  visit: Pick<VisitInvite, "title" | "kind">,
): string {
  const label = VISIT_KIND_LABELS[visit.kind] ?? visit.kind;
  const title = visit.title.trim();
  if (!title) return label;
  if (title.toLowerCase().includes(label.toLowerCase())) return title;
  return label + ": " + title;
}

export type VisitInviteAction =
  | {
      action: "upsert_visit";
      orgId: string;
      id?: string | null;
      title: string;
      kind: VisitKind;
      startsAt: string;
      endsAt: string | null;
      location: string;
      description: string;
      capacity: number | null;
      status: VisitStatus;
      syncToCalendar: boolean;
    }
  | { action: "delete_visit"; orgId: string; id: string }
  | {
      action: "add_host";
      orgId: string;
      visitId: string;
      userId: string | null;
      hostName: string;
      notes: string;
    }
  | { action: "remove_host"; orgId: string; id: string }
  | {
      action: "add_demo";
      orgId: string;
      visitId: string;
      userId: string | null;
      studentName: string;
      demoTitle: string;
      notes: string;
      sortOrder: number;
    }
  | { action: "remove_demo"; orgId: string; id: string }
  | {
      action: "set_rsvp";
      orgId: string;
      visitId: string;
      response: RsvpResponse;
      partySize: number;
      guestName: string;
      guestEmail: string;
      note: string;
      userId?: string | null;
    }
  | { action: "remove_rsvp"; orgId: string; id: string };

export function parseVisitInviteAction(raw: unknown): VisitInviteAction {
  const body = asRecord(raw);
  const action = requireString(body.action, "action", 40);
  const orgId = requireUuid(body.orgId, "orgId");

  switch (action) {
    case "upsert_visit": {
      const startsAt = requireString(body.startsAt, "startsAt", 64);
      if (Number.isNaN(Date.parse(startsAt))) throw new Error("startsAt is invalid");
      let endsAt: string | null = null;
      if (body.endsAt != null && body.endsAt !== "") {
        endsAt = requireString(body.endsAt, "endsAt", 64);
        if (Number.isNaN(Date.parse(endsAt))) throw new Error("endsAt is invalid");
      }
      return {
        action: "upsert_visit",
        orgId,
        id: optionalUuid(body.id),
        title: requireString(body.title, "title", 200),
        kind: requireKind(body.kind),
        startsAt,
        endsAt,
        location: optionalString(body.location, 240),
        description: optionalString(body.description, 4000),
        capacity: optionalCapacity(body.capacity),
        status: body.status == null || body.status === "" ? "scheduled" : requireStatus(body.status),
        syncToCalendar: Boolean(body.syncToCalendar),
      };
    }
    case "delete_visit":
      return { action: "delete_visit", orgId, id: requireUuid(body.id, "id") };
    case "add_host":
      return {
        action: "add_host",
        orgId,
        visitId: requireUuid(body.visitId, "visitId"),
        userId: optionalUuid(body.userId),
        hostName: optionalString(body.hostName, 120),
        notes: optionalString(body.notes, 1000),
      };
    case "remove_host":
      return { action: "remove_host", orgId, id: requireUuid(body.id, "id") };
    case "add_demo":
      return {
        action: "add_demo",
        orgId,
        visitId: requireUuid(body.visitId, "visitId"),
        userId: optionalUuid(body.userId),
        studentName: optionalString(body.studentName, 120),
        demoTitle: requireString(body.demoTitle, "demoTitle", 200),
        notes: optionalString(body.notes, 1000),
        sortOrder:
          body.sortOrder == null || body.sortOrder === ""
            ? 0
            : Math.floor(Number(body.sortOrder)) || 0,
      };
    case "remove_demo":
      return { action: "remove_demo", orgId, id: requireUuid(body.id, "id") };
    case "set_rsvp":
      return {
        action: "set_rsvp",
        orgId,
        visitId: requireUuid(body.visitId, "visitId"),
        response: requireResponse(body.response),
        partySize: requirePartySize(body.partySize),
        guestName: optionalString(body.guestName, 120),
        guestEmail: optionalString(body.guestEmail, 200),
        note: optionalString(body.note, 1000),
        userId: optionalUuid(body.userId),
      };
    case "remove_rsvp":
      return { action: "remove_rsvp", orgId, id: requireUuid(body.id, "id") };
    default:
      throw new Error("Unknown action: " + action);
  }
}
