// Mentor Hours & Engagement domain types. Pure data shapes — no I/O, no framework imports.
// Tracks mentor time contributed to the team (build sessions, strategy, outreach, admin) plus
// role/cadence signals — the evidence trail teams use for grant reporting, not a payroll system.

export type MentorHoursRole = "mentor" | "professional_mentor" | "alumni_mentor" | "parent_volunteer" | "other";

export type MentorHoursCategory =
  | "build"
  | "strategy"
  | "programming"
  | "outreach"
  | "administration"
  | "competition"
  | "training"
  | "other";

export type MentorHoursEntry = {
  id: string;
  mentorName: string;
  mentorUserId: string | null;
  role: MentorHoursRole;
  category: MentorHoursCategory;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  durationMinutes: number;
  seasonYear: number;
  notes: string | null;
};

export type MentorHoursSummary = {
  totalEntries: number;
  totalMinutes: number;
  totalHours: number;
  uniqueMentors: number;
  byCategory: Array<{ category: MentorHoursCategory; entries: number; hours: number }>;
  byRole: Array<{ role: MentorHoursRole; entries: number; hours: number }>;
  byMentor: Array<{ mentorName: string; entries: number; hours: number }>;
  byMonth: Array<{ month: string; entries: number; hours: number }>;
  recent: MentorHoursEntry[];
  /** 0..1 signal blending volume with sustained cadence. */
  engagementSignal: number;
};

export type MentorHoursTier = "emerging" | "developing" | "strong";

export type MentorHoursEngagement = {
  /** 0..1 overall grant-readiness engagement score. */
  score: number;
  tier: MentorHoursTier;
  components: {
    volume: number;
    cadence: number;
    mentorBreadth: number;
    roleBreadth: number;
  };
  monthsActive: number;
  mentorsEngaged: number;
  recommendations: string[];
};
