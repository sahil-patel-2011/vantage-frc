// Matching Gift Multiplier Finder — pure helpers. No I/O, no framework imports.

import type {
  MatchingGiftContact,
  MatchingGiftMatch,
  MatchingGiftPledge,
  MatchingGiftPledgeStatus,
  MatchingGiftProgram,
  MatchingGiftRelationship,
  MatchingGiftSummary,
} from "./types";

export * from "./types";

export const MATCHING_GIFT_RELATIONSHIPS: MatchingGiftRelationship[] = ["parent", "alumni", "mentor", "other"];
export const MATCHING_GIFT_PLEDGE_STATUSES: MatchingGiftPledgeStatus[] = [
  "identified",
  "requested",
  "submitted",
  "matched",
  "denied",
];

export function relationshipLabel(value: MatchingGiftRelationship): string {
  switch (value) {
    case "parent":
      return "Parent/guardian";
    case "alumni":
      return "Alumni";
    case "mentor":
      return "Mentor";
    default:
      return "Other";
  }
}

export function pledgeStatusLabel(value: MatchingGiftPledgeStatus): string {
  switch (value) {
    case "identified":
      return "Identified";
    case "requested":
      return "Request sent";
    case "submitted":
      return "Submitted to employer";
    case "matched":
      return "Matched";
    case "denied":
      return "Denied";
    default:
      return value;
  }
}

/**
 * A small in-code reference list of well-known, publicly documented employer matching-gift
 * programs (the kind aggregated by public matching-gift databases such as Double the Donation).
 * Ratios/notes are general public-record approximations — always verify current terms with the
 * employer's HR/CSR portal before submitting a request. Copied into an org's own
 * matching_gift_finder_programs table (source='seed') the first time the org opens the tool, so
 * it becomes an editable, org-owned starting point rather than a fabricated per-org metric.
 */
export const MATCHING_GIFT_SEED_PROGRAMS: Array<{
  employerName: string;
  matchRatio: string;
  minGiftUsd: number | null;
  maxGiftUsd: number | null;
  annualDeadline: string | null;
  notes: string;
}> = [
  {
    employerName: "Microsoft",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 15000,
    annualDeadline: "Within 12 months of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with Microsoft's giving portal.",
  },
  {
    employerName: "Google",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 10000,
    annualDeadline: "Calendar year of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with Google's giving portal.",
  },
  {
    employerName: "Boeing",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 6000,
    annualDeadline: "Calendar year of the gift",
    notes: "Boeing has a documented history of matching STEM/FIRST-related gifts — verify current terms.",
  },
  {
    employerName: "Bank of America",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 5000,
    annualDeadline: "Calendar year of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with the employer's giving portal.",
  },
  {
    employerName: "General Motors",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 5000,
    annualDeadline: "Calendar year of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with the employer's giving portal.",
  },
  {
    employerName: "Lockheed Martin",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 7500,
    annualDeadline: "Calendar year of the gift",
    notes: "Lockheed Martin has a documented history of supporting FIRST Robotics — verify current terms.",
  },
  {
    employerName: "3M",
    matchRatio: "1:1",
    minGiftUsd: 25,
    maxGiftUsd: 5000,
    annualDeadline: "Calendar year of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with the employer's giving portal.",
  },
  {
    employerName: "Johnson & Johnson",
    matchRatio: "1:1",
    minGiftUsd: 50,
    maxGiftUsd: 10000,
    annualDeadline: "Within 12 months of the gift",
    notes: "Public-record general terms — verify current ratio and eligible orgs with the employer's giving portal.",
  },
];

/** Normalize an employer name for equality comparison (case/whitespace/punctuation-insensitive). */
export function normalizeEmployerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|corp|co|company|corporation)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join contacts (with employer set) against the org's program list by normalized employer name. */
export function matchContactsToPrograms(
  contacts: MatchingGiftContact[],
  programs: MatchingGiftProgram[],
  pledges: MatchingGiftPledge[],
): MatchingGiftMatch[] {
  const programsByEmployer = new Map<string, MatchingGiftProgram>();
  for (const program of programs) {
    programsByEmployer.set(normalizeEmployerName(program.employerName), program);
  }
  const pledgedPairs = new Set(pledges.map((p) => `${p.contactId}::${p.programId}`));

  const matches: MatchingGiftMatch[] = [];
  for (const contact of contacts) {
    if (!contact.employerName) continue;
    const program = programsByEmployer.get(normalizeEmployerName(contact.employerName));
    if (!program) continue;
    matches.push({
      contactId: contact.id,
      contactName: contact.fullName,
      program,
      hasPledge: pledgedPairs.has(`${contact.id}::${program.id}`),
    });
  }
  return matches;
}

export function summarizeMatchingGiftFinder(
  contacts: MatchingGiftContact[],
  programs: MatchingGiftProgram[],
  pledges: MatchingGiftPledge[],
  matches: MatchingGiftMatch[],
): MatchingGiftSummary {
  const pledgeCountByStatus: Record<MatchingGiftPledgeStatus, number> = {
    identified: 0,
    requested: 0,
    submitted: 0,
    matched: 0,
    denied: 0,
  };
  let potentialMatchUsd = 0;
  for (const pledge of pledges) {
    pledgeCountByStatus[pledge.status] += 1;
    if ((pledge.status === "matched" || pledge.status === "submitted") && pledge.pledgeAmountUsd != null) {
      potentialMatchUsd += pledge.pledgeAmountUsd;
    }
  }
  return {
    totalContacts: contacts.length,
    contactsWithEmployer: contacts.filter((c) => c.employerName).length,
    totalPrograms: programs.length,
    unmatchedMatchCount: matches.filter((m) => !m.hasPledge).length,
    pledgeCountByStatus,
    potentialMatchUsd,
  };
}

/**
 * Deterministic HR matching-gift request letter grounded only in the contact/program facts passed
 * in — never fabricated. Wrapped by the caller in meteredAI so generation is billed/audited through
 * the standard usage-ledger path.
 */
export function buildDraftLetter(input: {
  contactName: string;
  employerName: string;
  matchRatio: string;
  teamNumber: number | null;
  seasonYear: number;
  minGiftUsd: number | null;
  maxGiftUsd: number | null;
  submissionUrl: string | null;
}): { subject: string; body: string } {
  const teamLine = input.teamNumber ? `FIRST Robotics Competition Team ${input.teamNumber}` : "our FIRST Robotics Competition team";
  const capLine =
    input.minGiftUsd != null || input.maxGiftUsd != null
      ? ` (eligible gifts typically between ${input.minGiftUsd != null ? `$${input.minGiftUsd.toLocaleString()}` : "any amount"} and ${
          input.maxGiftUsd != null ? `$${input.maxGiftUsd.toLocaleString()}` : "no stated cap"
        }, per ${input.employerName}'s published terms)`
      : "";
  const submissionLine = input.submissionUrl
    ? ` You can submit the match request directly at ${input.submissionUrl}.`
    : " Please let me know the submission process for our records.";

  const subject = `Matching gift request — ${input.employerName} employee gift to ${teamLine}`;
  const body = [
    `Hello,`,
    ``,
    `${input.contactName} is an employee of ${input.employerName} and has made (or plans to make) a gift to ${teamLine}, a registered nonprofit robotics program.`,
    ``,
    `${input.employerName} publishes a ${input.matchRatio} matching-gift program for employee charitable donations${capLine}. We'd like to request that this gift be matched under that program for the ${input.seasonYear} season.`,
    ``,
    `${submissionLine}`,
    ``,
    `Thank you for supporting STEM education through your matching-gift program.`,
  ].join("\n");

  return { subject, body };
}
