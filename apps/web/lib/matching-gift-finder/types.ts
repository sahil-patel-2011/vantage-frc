// Matching Gift Multiplier Finder domain types. Pure data shapes — no I/O, no framework imports.
// Household-employer contact records are joined against a curated/lookup employer matching-gift
// program dataset to produce a matched-company list, plus manual pledge-status tracking and
// per-employer AI-drafted HR request letters. No payment processing.

export type MatchingGiftRelationship = "parent" | "alumni" | "mentor" | "other";

export type MatchingGiftPledgeStatus = "identified" | "requested" | "submitted" | "matched" | "denied";

export type MatchingGiftProgramSource = "seed" | "manual";

export type MatchingGiftContact = {
  id: string;
  fullName: string;
  relationship: MatchingGiftRelationship;
  employerName: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
};

export type MatchingGiftProgram = {
  id: string;
  employerName: string;
  matchRatio: string;
  minGiftUsd: number | null;
  maxGiftUsd: number | null;
  annualDeadline: string | null;
  submissionUrl: string | null;
  notes: string | null;
  source: MatchingGiftProgramSource;
  createdAt: string;
};

export type MatchingGiftPledge = {
  id: string;
  contactId: string;
  contactName: string;
  programId: string;
  employerName: string;
  status: MatchingGiftPledgeStatus;
  pledgeAmountUsd: number | null;
  requestedOn: string | null;
  resolvedOn: string | null;
  notes: string | null;
  createdAt: string;
};

export type MatchingGiftDraft = {
  id: string;
  contactId: string;
  contactName: string;
  programId: string | null;
  employerName: string | null;
  subject: string;
  body: string;
  createdAt: string;
};

/** A contact whose employer matched a program the org hasn't yet tracked with a pledge. */
export type MatchingGiftMatch = {
  contactId: string;
  contactName: string;
  program: MatchingGiftProgram;
  hasPledge: boolean;
};

export type MatchingGiftSummary = {
  totalContacts: number;
  contactsWithEmployer: number;
  totalPrograms: number;
  unmatchedMatchCount: number;
  pledgeCountByStatus: Record<MatchingGiftPledgeStatus, number>;
  potentialMatchUsd: number;
};
