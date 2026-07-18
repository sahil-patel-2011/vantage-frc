// Morning standup digest domain types. Pure data shapes — no I/O, no framework imports.
// Compiles yesterday's shop hours, task movement, open blockers, attendance, and knowledge
// edits (all real rows from existing feature tables) into a per-subteam brief.

export type TaskMovementEvent = "completed" | "blocked" | "created" | "updated";

export type StandupTaskMovement = {
  taskId: string;
  title: string;
  subteam: string;
  status: string;
  assignee: string | null;
  event: TaskMovementEvent;
  occurredAt: string;
};

export type StandupBlocker = {
  taskId: string;
  title: string;
  subteam: string;
  assignee: string | null;
  blockedReason: string | null;
  ageDays: number;
};

export type StandupHoursByKind = { kind: string; hours: number };

export type StandupHoursContributor = { userId: string; name: string; hours: number };

export type StandupHoursSummary = {
  totalHours: number;
  byKind: StandupHoursByKind[];
  topContributors: StandupHoursContributor[];
};

export type StandupAttendanceEvent = {
  id: string;
  title: string;
  kind: string;
  occurredOn: string;
  attendeeCount: number;
  creditHours: number;
};

export type StandupAttendanceSummary = {
  eventsCount: number;
  totalAttendees: number;
  totalCreditHours: number;
  events: StandupAttendanceEvent[];
};

export type StandupKnowledgeEdit = {
  pageId: string;
  title: string;
  updatedByName: string | null;
  updatedAt: string;
  created: boolean;
};

export type StandupSubteamBrief = {
  subteam: string;
  tasksCompleted: number;
  tasksBlocked: number;
  tasksCreated: number;
  openBlockers: StandupBlocker[];
  headline: string;
};

export type StandupDigestSummary = {
  digestDate: string;
  windowStart: string;
  windowEnd: string;
  hours: StandupHoursSummary;
  taskMovement: StandupTaskMovement[];
  blockers: StandupBlocker[];
  attendance: StandupAttendanceSummary;
  knowledgeEdits: StandupKnowledgeEdit[];
  subteamBriefs: StandupSubteamBrief[];
  headline: string;
};

export type StandupDigestNote = {
  id: string;
  digestDate: string;
  subteam: string;
  note: string;
  createdByName: string | null;
  createdAt: string;
};

export type StandupDigestRun = {
  id: string;
  digestDate: string;
  headline: string;
  generatedByName: string | null;
  createdAt: string;
};
