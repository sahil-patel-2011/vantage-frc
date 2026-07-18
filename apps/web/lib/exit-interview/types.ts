// Graduation exit-interview domain types. Pure data shapes — no I/O, no framework imports.
// Captures the structured off-boarding record for an outgoing member — the evidence trail
// that feeds the alumni/knowledge base, not a live chat transcript.

export type ExitInterviewRole =
  | "mechanical"
  | "electrical"
  | "programming"
  | "strategy"
  | "outreach"
  | "leadership"
  | "mentor"
  | "other";

export type ExitInterviewStatus = "draft" | "submitted";

export type ExitInterviewRecord = {
  id: string;
  memberName: string;
  memberUserId: string | null;
  role: ExitInterviewRole;
  yearsOnTeam: number;
  graduationYear: number;
  seasonYear: number;
  highlights: string | null;
  adviceForFuture: string | null;
  skillsToDocument: string | null;
  willingToMentor: boolean;
  contactEmail: string | null;
  status: ExitInterviewStatus;
};

export type ExitInterviewSummary = {
  totalRecords: number;
  submittedCount: number;
  draftCount: number;
  mentorshipWillingCount: number;
  byRole: Array<{ role: ExitInterviewRole; count: number }>;
  byGradYear: Array<{ graduationYear: number; count: number }>;
};
