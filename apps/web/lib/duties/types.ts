/**
 * On-duty / chaperone watches owned by /duties.
 *
 * Scout, pit, drive-team, and outreach slots stay on the calendar roster
 * (`duty_assignments` kinds from 0145). These two kinds are the ones My Day
 * should read: who is the adult on the floor right now. Nothing is invented —
 * a watch with no assignee is stored but does not become a My Day cue.
 */

export const WATCH_KINDS = ["on_duty", "chaperone"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const WATCH_KIND_LABELS: Record<WatchKind, string> = {
  on_duty: "On duty",
  chaperone: "Chaperone",
};

/** Roster kinds the duties page still lists read-only (calendar owns writes). */
export const ROSTER_KINDS = ["scouting", "pit", "drive_team", "outreach"] as const;
export type RosterKind = (typeof ROSTER_KINDS)[number];

export const ROSTER_KIND_LABELS: Record<RosterKind, string> = {
  scouting: "Scouting",
  pit: "Pit duty",
  drive_team: "Drive team",
  outreach: "Outreach",
};

export type DutyWatch = {
  id: string;
  kind: WatchKind;
  title: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  phone: string;
  startsAt: string;
  endsAt: string | null;
  locationNote: string;
  notes: string;
  mine: boolean;
};

export type DutyRosterSlot = {
  id: string;
  title: string;
  kind: RosterKind;
  startsAt: string;
  endsAt: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  subteamName: string | null;
};

/**
 * Cue shape My Day already renders for `logistics.onDuty`. Import
 * `loadOnDutyForMyDay` from this package instead of querying logistics.
 * `tripId` is always null — duties are not trip-scoped.
 */
export type MyDayDutyCue = {
  id: string;
  tripId: string | null;
  mentorUserId: string | null;
  mentorName: string;
  phone: string;
  startsAt: string;
  endsAt: string | null;
  locationNote: string;
  notes: string;
  kind: WatchKind;
};

export type DutiesMember = {
  userId: string;
  name: string | null;
  email: string | null;
};

export type DutiesView =
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      role: string;
      userId: string;
      canManage: boolean;
      watches: DutyWatch[];
      /** Assigned watch that is active now, else the next assigned one. Null until someone is posted. */
      activeWatch: DutyWatch | null;
      myDayCue: MyDayDutyCue | null;
      roster: DutyRosterSlot[];
      members: DutiesMember[];
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
    };
