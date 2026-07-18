// Meeting-agenda autopilot domain types. Pure data shapes — no I/O, no framework imports.
// An "agenda item" is a grounded read from an existing source table (open blocker, overdue
// task, unresolved decision, or open FMEA failure) surfaced for a team meeting. An "agenda" is
// a persisted snapshot of those items generated for a specific meeting. An "action item" is a
// deterministically parsed follow-up drafted from the post-meeting minutes text, linked back to
// the agenda that produced the meeting.

export type AgendaItemKind = "blocker" | "overdue_task" | "decision" | "fmea";

/** A single agenda entry grounded in one source row — nothing fabricated. */
export type AgendaItem = {
  kind: AgendaItemKind;
  sourceId: string;
  title: string;
  detail: string;
  /** Higher sorts first within the agenda. */
  weight: number;
};

export type AgendaSourceCounts = {
  blockers: number;
  overdueTasks: number;
  decisions: number;
  fmea: number;
};

export type MeetingAgendaStatus = "draft" | "finalized";

/** A persisted agenda snapshot generated for a specific meeting. */
export type MeetingAgenda = {
  id: string;
  seasonYear: number;
  title: string;
  meetingOn: string | null;
  agendaItems: AgendaItem[];
  sourceCounts: AgendaSourceCounts;
  status: MeetingAgendaStatus;
  createdAt: string;
  updatedAt: string;
};

export type ActionItemStatus = "open" | "done";

/** A follow-up action item deterministically parsed from post-meeting minutes text. */
export type ActionItem = {
  id: string;
  agendaId: string;
  title: string;
  owner: string | null;
  dueOn: string | null;
  status: ActionItemStatus;
  sourceExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Deterministic minutes-parsing result — grounded only in the minutes text supplied. */
export type ParsedActionItem = {
  title: string;
  owner: string | null;
  dueOn: string | null;
  sourceExcerpt: string;
};

/** Raw source rows the agenda is grounded in — nothing else. */
export type AgendaSourceInput = {
  blockers: Array<{ id: string; title: string; subsystem: string; blockedReason: string | null; priority: string }>;
  overdueTasks: Array<{ id: string; title: string; subsystem: string; dueOn: string; priority: string }>;
  decisions: Array<{ id: string; title: string; category: string; createdAt: string }>;
  fmeaFailures: Array<{
    id: string;
    title: string;
    subsystemName: string;
    severity: number;
    occurrence: number;
    detection: number;
  }>;
};
