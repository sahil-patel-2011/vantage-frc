// Sponsor Suite domain types. Pure data shapes — no I/O, no framework imports.
// Builds on the existing sponsors / sponsor_contributions tables (0035_team_finance_sponsors.sql)
// with four new sponsor_suite_* tables: pitch/renewal decks, end-of-season ROI reports,
// thank-you/renewal reminders, and a season fundraising goal.

export type SponsorSuiteDeckKind = "pitch" | "renewal";

export type SponsorSuiteReminderKind = "thank_you" | "renewal";
export type SponsorSuiteReminderStatus = "pending" | "sent" | "dismissed";

/** A generated pitch/renewal deck outline for a sponsor (or a general prospect pitch when sponsorId is null). */
export type SponsorSuiteDeck = {
  id: string;
  sponsorId: string | null;
  sponsorName: string | null;
  kind: SponsorSuiteDeckKind;
  seasonYear: number;
  title: string;
  sections: SponsorSuiteDeckSection[];
  createdAt: string;
};

export type SponsorSuiteDeckSection = {
  heading: string;
  body: string;
};

/** Per-sponsor ROI line inside an end-of-season ROI report. */
export type SponsorSuiteRoiLine = {
  sponsorId: string;
  sponsorName: string;
  tier: string;
  totalContributedUsd: number;
  contributionCount: number;
};

/** A saved end-of-season ROI report, persisted to sponsor_suite_roi_reports. */
export type SponsorSuiteRoiReport = {
  id: string;
  seasonYear: number;
  totalRaisedUsd: number;
  totalSponsors: number;
  goalUsd: number | null;
  goalAttainmentPct: number | null;
  lines: SponsorSuiteRoiLine[];
  narrative: string;
  createdAt: string;
};

/** A due thank-you / renewal reminder for a sponsor. */
export type SponsorSuiteReminder = {
  id: string;
  sponsorId: string;
  sponsorName: string;
  kind: SponsorSuiteReminderKind;
  dueOn: string;
  status: SponsorSuiteReminderStatus;
  note: string | null;
  createdAt: string;
};

/** Season fundraising goal vs. actual (actual computed live from sponsor_contributions). */
export type SponsorSuiteGoalProgress = {
  seasonYear: number;
  goalUsd: number | null;
  actualUsd: number;
  attainmentPct: number | null;
  remainingUsd: number | null;
};
