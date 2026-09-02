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
  knowledgePageId: string | null;
};

/** A self-serve link handed to an outgoing member (owner/admin view only). */
export type ExitInterviewInvite = {
  id: string;
  memberName: string;
  memberEmail: string | null;
  memberUserId: string | null;
  seasonYear: number;
  expiresAt: string;
  usedAt: string | null;
  responseId: string | null;
  createdAt: string;
  state: "open" | "used" | "expired";
};

/** Roster entry offered when targeting an invite at a member. */
export type ExitInterviewMember = {
  userId: string;
  name: string;
  email: string;
};

export type ExitInterviewSummary = {
  totalRecords: number;
  submittedCount: number;
  draftCount: number;
  mentorshipWillingCount: number;
  wikiPageCount: number;
  byRole: Array<{ role: ExitInterviewRole; count: number }>;
  byGradYear: Array<{ graduationYear: number; count: number }>;
};
