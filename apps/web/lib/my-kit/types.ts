/**
 * My Kit — the per-person view.
 *
 * "What do I, personally, need right now" answered by composing data that already
 * exists in other org-scoped surfaces. My Kit owns no tables and writes nothing:
 * every row links back to the surface that owns it.
 *
 * Honesty rules baked into these shapes:
 *   - `available: false` means the owning table is absent from this database
 *     (older deploy, feature never migrated). It is NOT the same as "you have none",
 *     so the UI must say something different for each.
 *   - Nothing is ever invented. A section with no rows renders `emptyLabel`.
 */

export type MyKitSectionId =
  | "tasks"
  | "calendar"
  | "duties"
  | "scouting"
  | "media"
  | "hours"
  | "learning"
  | "skills"
  | "tools"
  | "money"
  | "onboarding";

/** Which subteam lens to lead with. Derived, never stored. */
export type MyKitFocus =
  | "scouting"
  | "media"
  | "electrical"
  | "programming"
  | "mechanical"
  | "cad"
  | "drive_team"
  | "business"
  | "safety"
  | "general";

export type MyKitTone = "neutral" | "due" | "overdue" | "done" | "info";

/** One actionable line. `href` always points at the surface that owns the record. */
export type MyKitRow = {
  id: string;
  title: string;
  /** Secondary line. Empty string when there is nothing honest to add. */
  detail: string;
  /** Trailing chip — a due date, a status, a count. Empty string when unknown. */
  meta: string;
  href: string;
  tone: MyKitTone;
};

export type MyKitSection = {
  id: MyKitSectionId;
  title: string;
  /** Why this section is showing where it is. Empty when the placement is generic. */
  reason: string;
  /** The owning surface for the whole section. */
  href: string;
  /** False when the backing table does not exist in this database. */
  available: boolean;
  rows: MyKitRow[];
  /** Shown when `available` and `rows` is empty. */
  emptyLabel: string;
  /** True when the person's subteam focus pulled this section to the top. */
  emphasis: boolean;
  /** Count of rows that are actionable right now (overdue or due). */
  actionable: number;
};

export type MyKitHours = {
  totalMinutes: number;
  sessionCount: number;
  /** Consecutive UTC days with a log, counting back from the latest logged day. */
  streakDays: number;
  /** UTC date (YYYY-MM-DD) of the most recent log, or null. */
  lastLoggedOn: string | null;
  /** A clock-in with no clock-out. */
  openSession: boolean;
};

export type MyKitPerson = {
  userId: string;
  displayName: string;
  /** Org membership role: owner / admin / member. */
  orgRole: string;
  /** Profile team role: student / mentor / coach / parent / other. */
  teamRole: string | null;
  subteams: Array<{ id: string; name: string }>;
  focus: MyKitFocus;
  focusLabel: string;
  /** Role-onboarding track keys matched from the same subteam names. */
  trackKeys: string[];
};

export type MyKitQuickLink = { id: string; label: string; href: string };

export type MyKitSetupStep = { id: string; label: string; detail: string; href: string };

export type MyKitView =
  | {
      status: "setup_required";
      message: string;
      steps: MyKitSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      person: MyKitPerson;
      /** Focus-first ordering; every section is always present. */
      sections: MyKitSection[];
      hours: MyKitHours;
      /** Tools/links this person's subteam reaches for most. */
      quickLinks: MyKitQuickLink[];
      /** Total rows needing action today across every section. */
      actionableCount: number;
      /** Sections whose table is missing from this database. */
      unavailableSections: MyKitSectionId[];
      computedAt: string;
    };

// ---------------------------------------------------------------------------
// Raw record shapes handed to the pure composer by the loader.
// ---------------------------------------------------------------------------

export type MyKitTaskRecord = {
  id: string;
  source: "build_task" | "todo";
  title: string;
  status: string;
  /** Subsystem (build task) or subteam name (todo). Empty when unset. */
  context: string;
  dueOn: string | null;
  priority: string | null;
};

export type MyKitEventRecord = {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  location: string;
  /** Subteam display name, or "" for a whole-team entry. */
  subteamName: string;
  /** going / maybe / no / null when not answered. */
  rsvp: string | null;
};

export type MyKitDutyRecord = {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  notes: string;
};

export type MyKitScoutAssignmentRecord = {
  id: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  role: string;
  startsAt: string | null;
};

/** Extracted from the newest scout_accuracy_snapshots row. Null when unscored. */
export type MyKitScoutAccuracyRecord = {
  eventKey: string;
  entriesScored: number;
  accuracyScore: number;
  rank: number | null;
  scoutsScored: number;
  computedAt: string;
};

export type MyKitMediaRecord = {
  id: string;
  title: string;
  platform: string;
  status: string;
  dueAt: string | null;
};

export type MyKitHourLogRecord = {
  id: string;
  kind: string;
  clockIn: string;
  clockOut: string | null;
};

export type MyKitLearningRecord = {
  total: number;
  spotOn: number;
  close: number;
  off: number;
  skipped: number;
  lastAt: string | null;
};

export type MyKitSkillRecord = {
  id: string;
  label: string;
  proficiency: string;
};

export type MyKitCertificationRecord = {
  id: string;
  certType: string;
  completedOn: string;
  expiresOn: string | null;
};

export type MyKitToolLoanRecord = {
  id: string;
  toolName: string;
  checkedOutAt: string;
  dueAt: string | null;
};

export type MyKitMoneyRecord = {
  id: string;
  source: "purchase_request" | "reimbursement";
  title: string;
  status: string;
  amountUsd: number | null;
  createdAt: string | null;
};

export type MyKitOnboardingRecord = {
  trackKey: string;
  title: string;
  done: number;
  total: number;
};

/** Which sections have their backing table present in this database. */
export type MyKitAvailability = Record<MyKitSectionId, boolean>;

export type MyKitComposeInput = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  userId: string;
  displayName: string;
  orgRole: string;
  teamRole: string | null;
  subteams: Array<{ id: string; name: string }>;
  nowIso: string;
  availability: MyKitAvailability;
  tasks: MyKitTaskRecord[];
  events: MyKitEventRecord[];
  duties: MyKitDutyRecord[];
  scoutAssignments: MyKitScoutAssignmentRecord[];
  scoutAccuracy: MyKitScoutAccuracyRecord | null;
  media: MyKitMediaRecord[];
  hourLogs: MyKitHourLogRecord[];
  learning: MyKitLearningRecord | null;
  skills: MyKitSkillRecord[];
  certifications: MyKitCertificationRecord[];
  tools: MyKitToolLoanRecord[];
  money: MyKitMoneyRecord[];
  onboarding: MyKitOnboardingRecord[];
};
