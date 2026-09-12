// Client-safe duty roster types, labels, and pure helpers.
// Keep @vantage/core / DB access out of this file so Soft-UI clients can import it.

export const DUTY_KINDS = ["scouting", "pit", "drive_team", "outreach"] as const;
export type DutyKind = (typeof DUTY_KINDS)[number];

export const DUTY_KIND_LABELS: Record<DutyKind, string> = {
  scouting: "Scouting",
  pit: "Pit duty",
  drive_team: "Drive team",
  outreach: "Outreach",
};

export type DutyWorkflowLink = { href: string; label: string };

export type DutyAssignment = {
  id: string;
  title: string;
  kind: DutyKind;
  startsAt: string;
  endsAt: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  calendarEventId: string | null;
  notes: string;
  createdByName: string | null;
  mine: boolean;
};

export type DutyRosterView =
  | {
      status: "ready";
      orgId: string;
      teamNumber: number | null;
      orgName: string;
      role: string;
      userId: string;
      canManage: boolean;
      duties: DutyAssignment[];
      members: { userId: string; name: string | null; email: string | null }[];
      subteams: { id: string; name: string; color: string }[];
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
    };

function withOrgPath(path: string, orgId: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Deep links from a duty card into scout / pit / command / outreach surfaces. */
export function dutyWorkflowLinks(kind: DutyKind, orgId: string): DutyWorkflowLink[] {
  switch (kind) {
    case "scouting":
      return [
        { href: withOrgPath("/scouting", orgId), label: "Scout forms" },
        { href: withOrgPath("/scouting/lineup", orgId), label: "Lineup & coverage" },
      ];
    case "pit":
      return [
        { href: withOrgPath("/pit", orgId), label: "Pit Command" },
        { href: withOrgPath("/command", orgId), label: "Event day" },
      ];
    case "drive_team":
      return [
        { href: withOrgPath("/command", orgId), label: "Event day" },
        { href: withOrgPath("/practice", orgId), label: "Practice" },
      ];
    case "outreach":
      return [
        { href: withOrgPath("/impact", orgId), label: "Impact" },
        { href: withOrgPath("/business", orgId), label: "Business" },
      ];
  }
}

/** Map a duty kind onto a subteam calendar event kind for the shared calendar. */
export function dutyToCalendarKind(kind: DutyKind): "event" | "outreach" | "meeting" {
  if (kind === "outreach") return "outreach";
  if (kind === "scouting") return "event";
  return "event";
}

export function defaultDutyTitle(kind: DutyKind): string {
  return DUTY_KIND_LABELS[kind];
}

/** Team view = all duties; personal = assigned to me (or my subteam with no member). */
export function filterDutiesForScope(
  duties: DutyAssignment[],
  scope: "team" | "mine",
  userId: string,
  mySubteamIds: string[] = [],
): DutyAssignment[] {
  if (scope === "team") return duties;
  const mine = new Set(mySubteamIds);
  return duties.filter(
    (duty) =>
      duty.assignedUserId === userId ||
      (duty.assignedUserId == null && duty.subteamId != null && mine.has(duty.subteamId)),
  );
}

export function sortDuties<T extends { startsAt: string; title: string }>(duties: T[]): T[] {
  return [...duties].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title),
  );
}

export function groupDutiesByDay<T extends { startsAt: string; title: string }>(
  duties: T[],
): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const duty of sortDuties(duties)) {
    const day = duty.startsAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(duty);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}

export function isDutyKind(value: unknown): value is DutyKind {
  return typeof value === "string" && (DUTY_KINDS as readonly string[]).includes(value);
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return uuid(value, label);
}

function isoDateTime(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date/time`);
  return date.toISOString();
}

function optionalIsoDateTime(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return isoDateTime(value, label);
}

export type DutyAction =
  | {
      action: "create_duty";
      orgId: string;
      title: string;
      kind: DutyKind;
      startsAt: string;
      endsAt: string | null;
      subteamId: string | null;
      assignedUserId: string | null;
      calendarEventId: string | null;
      notes: string;
      /** When true and no calendarEventId, create a linked calendar event. */
      linkCalendar: boolean;
    }
  | {
      action: "update_duty";
      orgId: string;
      id: string;
      title?: string;
      kind?: DutyKind;
      startsAt?: string;
      endsAt?: string | null;
      subteamId?: string | null;
      assignedUserId?: string | null;
      notes?: string;
    }
  | { action: "delete_duty"; orgId: string; id: string };

export function parseDutyAction(input: unknown): DutyAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid duty action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_duty": {
      const kind = isDutyKind(body.kind) ? body.kind : null;
      if (!kind) throw new Error("Kind is invalid");
      const title =
        body.title == null || String(body.title).trim() === ""
          ? defaultDutyTitle(kind)
          : requiredText(body.title, "Title", 200);
      const startsAt = isoDateTime(body.startsAt, "Start");
      const endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (endsAt && endsAt < startsAt) throw new Error("End must be on or after start");
      return {
        action,
        orgId,
        title,
        kind,
        startsAt,
        endsAt,
        subteamId: optionalUuid(body.subteamId, "Subteam"),
        assignedUserId: optionalUuid(body.assignedUserId, "Assignee"),
        calendarEventId: optionalUuid(body.calendarEventId, "Calendar event"),
        notes: optionalText(body.notes, 2000),
        linkCalendar: body.linkCalendar !== false,
      };
    }
    case "update_duty": {
      const id = uuid(body.id, "Duty");
      const patch: Extract<DutyAction, { action: "update_duty" }> = { action, orgId, id };
      if (body.title !== undefined) patch.title = requiredText(body.title, "Title", 200);
      if (body.kind !== undefined) {
        if (!isDutyKind(body.kind)) throw new Error("Kind is invalid");
        patch.kind = body.kind;
      }
      if (body.startsAt !== undefined) patch.startsAt = isoDateTime(body.startsAt, "Start");
      if (body.endsAt !== undefined) patch.endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (body.subteamId !== undefined) patch.subteamId = optionalUuid(body.subteamId, "Subteam");
      if (body.assignedUserId !== undefined) {
        patch.assignedUserId = optionalUuid(body.assignedUserId, "Assignee");
      }
      if (body.notes !== undefined) patch.notes = optionalText(body.notes, 2000);
      return patch;
    }
    case "delete_duty":
      return { action, orgId, id: uuid(body.id, "Duty") };
    default:
      throw new Error("Unsupported duty action");
  }
}
