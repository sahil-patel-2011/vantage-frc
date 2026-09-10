import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { MATCHING_GIFT_SEED_PROGRAMS, buildDraftLetter, matchContactsToPrograms, summarizeMatchingGiftFinder } from ".";
import type {
  MatchingGiftContact,
  MatchingGiftDraft,
  MatchingGiftMatch,
  MatchingGiftPledge,
  MatchingGiftPledgeStatus,
  MatchingGiftProgram,
  MatchingGiftRelationship,
  MatchingGiftSummary,
} from "./types";

export type MatchingGiftFinderSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchingGiftFinderView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchingGiftFinderSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      contacts: MatchingGiftContact[];
      programs: MatchingGiftProgram[];
      pledges: MatchingGiftPledge[];
      drafts: MatchingGiftDraft[];
      matches: MatchingGiftMatch[];
      summary: MatchingGiftSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

function setupSteps(orgId: string | null): MatchingGiftFinderSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Matching Gift Finder.",
      href: "/workspace",
    },
    {
      id: "contact",
      label: "Add a household contact",
      detail: "Add a parent, alumni, or mentor contact and fill in their employer to unlock matching.",
      href: orgId ? `/matching-gift-finder?orgId=${encodeURIComponent(orgId)}` : "/matching-gift-finder",
    },
  ];
}

type ContactRow = {
  id: string;
  fullName: string;
  relationship: MatchingGiftRelationship;
  employerName: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
};

function mapContact(row: ContactRow): MatchingGiftContact {
  return {
    id: row.id,
    fullName: row.fullName,
    relationship: row.relationship,
    employerName: row.employerName,
    email: row.email,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type ProgramRow = {
  id: string;
  employerName: string;
  matchRatio: string;
  minGiftUsd: string | null;
  maxGiftUsd: string | null;
  annualDeadline: string | null;
  submissionUrl: string | null;
  notes: string | null;
  source: MatchingGiftProgram["source"];
  createdAt: string;
};

function mapProgram(row: ProgramRow): MatchingGiftProgram {
  return {
    id: row.id,
    employerName: row.employerName,
    matchRatio: row.matchRatio,
    minGiftUsd: row.minGiftUsd != null ? Number(row.minGiftUsd) : null,
    maxGiftUsd: row.maxGiftUsd != null ? Number(row.maxGiftUsd) : null,
    annualDeadline: row.annualDeadline,
    submissionUrl: row.submissionUrl,
    notes: row.notes,
    source: row.source,
    createdAt: row.createdAt,
  };
}

type PledgeRow = {
  id: string;
  contactId: string;
  contactName: string;
  programId: string;
  employerName: string;
  status: MatchingGiftPledgeStatus;
  pledgeAmountUsd: string | null;
  requestedOn: string | null;
  resolvedOn: string | null;
  notes: string | null;
  createdAt: string;
};

function mapPledge(row: PledgeRow): MatchingGiftPledge {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contactName,
    programId: row.programId,
    employerName: row.employerName,
    status: row.status,
    pledgeAmountUsd: row.pledgeAmountUsd != null ? Number(row.pledgeAmountUsd) : null,
    requestedOn: row.requestedOn,
    resolvedOn: row.resolvedOn,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type DraftRow = {
  id: string;
  contactId: string;
  contactName: string;
  programId: string | null;
  employerName: string | null;
  subject: string;
  body: string;
  createdAt: string;
};

function mapDraft(row: DraftRow): MatchingGiftDraft {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contactName,
    programId: row.programId,
    employerName: row.employerName,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt,
  };
}

/** Copy the small in-code reference list into an org's own program table, once, on first load. */
async function ensureSeedPrograms(client: PoolClient, orgId: string): Promise<void> {
  const existing = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM matching_gift_finder_programs WHERE org_id = $1`,
    [orgId],
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  for (const seed of MATCHING_GIFT_SEED_PROGRAMS) {
    await client.query(
      `INSERT INTO matching_gift_finder_programs (
         org_id, employer_name, match_ratio, min_gift_usd, max_gift_usd, annual_deadline, notes, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'seed')
       ON CONFLICT (org_id, lower(employer_name)) DO NOTHING`,
      [
        orgId,
        seed.employerName,
        seed.matchRatio,
        seed.minGiftUsd,
        seed.maxGiftUsd,
        seed.annualDeadline,
        seed.notes,
      ],
    );
  }
}

export async function computeMatchingGiftFinderView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MatchingGiftFinderView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to find employer matching-gift programs.",
      steps: setupSteps(null),
      orgId: null,
    };
  }

  await ensureSeedPrograms(client, org.orgId);

  const [contactResult, programResult, pledgeResult, draftResult] = await Promise.all([
    client.query<ContactRow>(
      `SELECT id, full_name AS "fullName", relationship, employer_name AS "employerName",
              email, notes, created_at AS "createdAt"
       FROM matching_gift_finder_contacts
       WHERE org_id = $1
       ORDER BY full_name`,
      [org.orgId],
    ),
    client.query<ProgramRow>(
      `SELECT id, employer_name AS "employerName", match_ratio AS "matchRatio",
              min_gift_usd::text AS "minGiftUsd", max_gift_usd::text AS "maxGiftUsd",
              annual_deadline AS "annualDeadline", submission_url AS "submissionUrl", notes,
              source, created_at AS "createdAt"
       FROM matching_gift_finder_programs
       WHERE org_id = $1
       ORDER BY employer_name`,
      [org.orgId],
    ),
    client.query<PledgeRow>(
      `SELECT p.id, p.contact_id AS "contactId", c.full_name AS "contactName",
              p.program_id AS "programId", g.employer_name AS "employerName",
              p.status, p.pledge_amount_usd::text AS "pledgeAmountUsd",
              p.requested_on::text AS "requestedOn", p.resolved_on::text AS "resolvedOn",
              p.notes, p.created_at AS "createdAt"
       FROM matching_gift_finder_pledges p
       JOIN matching_gift_finder_contacts c ON c.id = p.contact_id
       JOIN matching_gift_finder_programs g ON g.id = p.program_id
       WHERE p.org_id = $1
       ORDER BY p.created_at DESC`,
      [org.orgId],
    ),
    client.query<DraftRow>(
      `SELECT d.id, d.contact_id AS "contactId", c.full_name AS "contactName",
              d.program_id AS "programId", g.employer_name AS "employerName",
              d.subject, d.body, d.created_at AS "createdAt"
       FROM matching_gift_finder_drafts d
       JOIN matching_gift_finder_contacts c ON c.id = d.contact_id
       LEFT JOIN matching_gift_finder_programs g ON g.id = d.program_id
       WHERE d.org_id = $1
       ORDER BY d.created_at DESC
       LIMIT 30`,
      [org.orgId],
    ),
  ]);

  const contacts = contactResult.rows.map(mapContact);
  const programs = programResult.rows.map(mapProgram);
  const pledges = pledgeResult.rows.map(mapPledge);
  const drafts = draftResult.rows.map(mapDraft);
  const matches = matchContactsToPrograms(contacts, programs, pledges);
  const summary = summarizeMatchingGiftFinder(contacts, programs, pledges, matches);

  if (contacts.filter((c) => c.employerName).length === 0) {
    return {
      status: "setup_required",
      message: "Add household contacts and fill in their employer to find matching-gift programs.",
      steps: setupSteps(org.orgId),
      orgId: org.orgId,
    };
  }

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    contacts,
    programs,
    pledges,
    drafts,
    matches,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addContact(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    fullName: string;
    relationship: MatchingGiftRelationship;
    employerName: string | null;
    email: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO matching_gift_finder_contacts (org_id, full_name, relationship, employer_name, email, notes, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.orgId, input.fullName, input.relationship, input.employerName, input.email, input.notes, input.userId],
  );
}

export async function updateContact(
  client: PoolClient,
  input: { orgId: string; contactId: string; employerName: string | null; notes: string | null },
): Promise<void> {
  await client.query(
    `UPDATE matching_gift_finder_contacts SET employer_name = $1, notes = $2 WHERE id = $3 AND org_id = $4`,
    [input.employerName, input.notes, input.contactId, input.orgId],
  );
}

export async function deleteContact(
  client: PoolClient,
  input: { orgId: string; contactId: string },
): Promise<void> {
  await client.query(`DELETE FROM matching_gift_finder_contacts WHERE id = $1 AND org_id = $2`, [
    input.contactId,
    input.orgId,
  ]);
}

export async function addProgram(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    employerName: string;
    matchRatio: string;
    minGiftUsd: number | null;
    maxGiftUsd: number | null;
    annualDeadline: string | null;
    submissionUrl: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO matching_gift_finder_programs (
       org_id, employer_name, match_ratio, min_gift_usd, max_gift_usd, annual_deadline, submission_url, notes, source, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
     ON CONFLICT (org_id, lower(employer_name)) DO UPDATE SET
       match_ratio = EXCLUDED.match_ratio,
       min_gift_usd = EXCLUDED.min_gift_usd,
       max_gift_usd = EXCLUDED.max_gift_usd,
       annual_deadline = EXCLUDED.annual_deadline,
       submission_url = EXCLUDED.submission_url,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      input.orgId,
      input.employerName,
      input.matchRatio,
      input.minGiftUsd,
      input.maxGiftUsd,
      input.annualDeadline,
      input.submissionUrl,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteProgram(
  client: PoolClient,
  input: { orgId: string; programId: string },
): Promise<void> {
  await client.query(`DELETE FROM matching_gift_finder_programs WHERE id = $1 AND org_id = $2`, [
    input.programId,
    input.orgId,
  ]);
}

export async function upsertPledge(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    contactId: string;
    programId: string;
    status: MatchingGiftPledgeStatus;
    pledgeAmountUsd: number | null;
    requestedOn: string | null;
    resolvedOn: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO matching_gift_finder_pledges (
       org_id, contact_id, program_id, status, pledge_amount_usd, requested_on, resolved_on, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9)
     ON CONFLICT (contact_id, program_id) DO UPDATE SET
       status = EXCLUDED.status,
       pledge_amount_usd = EXCLUDED.pledge_amount_usd,
       requested_on = EXCLUDED.requested_on,
       resolved_on = EXCLUDED.resolved_on,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      input.orgId,
      input.contactId,
      input.programId,
      input.status,
      input.pledgeAmountUsd,
      input.requestedOn,
      input.resolvedOn,
      input.notes,
      input.userId,
    ],
  );
}

export async function deletePledge(
  client: PoolClient,
  input: { orgId: string; pledgeId: string },
): Promise<void> {
  await client.query(`DELETE FROM matching_gift_finder_pledges WHERE id = $1 AND org_id = $2`, [
    input.pledgeId,
    input.orgId,
  ]);
}

export async function deleteDraft(
  client: PoolClient,
  input: { orgId: string; draftId: string },
): Promise<void> {
  await client.query(`DELETE FROM matching_gift_finder_drafts WHERE id = $1 AND org_id = $2`, [
    input.draftId,
    input.orgId,
  ]);
}

/**
 * Generate a metered HR matching-gift request letter for a contact/program pair, grounded only in
 * the contact's own record and the program's own recorded terms. Routed through meteredAI so the run
 * is billed and audited through the standard usage-ledger path.
 */
export async function generateDraftLetter(
  client: PoolClient,
  input: { orgId: string; userId: string; contactId: string; programId: string; seasonYear: number },
): Promise<MatchingGiftDraft> {
  const contactRow = await client.query<{ fullName: string }>(
    `SELECT full_name AS "fullName" FROM matching_gift_finder_contacts WHERE id = $1 AND org_id = $2`,
    [input.contactId, input.orgId],
  );
  const contactName = contactRow.rows[0]?.fullName;
  if (!contactName) throw new Error("Contact not found");

  const programRow = await client.query<ProgramRow>(
    `SELECT id, employer_name AS "employerName", match_ratio AS "matchRatio",
            min_gift_usd::text AS "minGiftUsd", max_gift_usd::text AS "maxGiftUsd",
            annual_deadline AS "annualDeadline", submission_url AS "submissionUrl", notes,
            source, created_at AS "createdAt"
     FROM matching_gift_finder_programs WHERE id = $1 AND org_id = $2`,
    [input.programId, input.orgId],
  );
  const program = programRow.rows[0] ? mapProgram(programRow.rows[0]) : null;
  if (!program) throw new Error("Program not found");

  const orgRow = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1`,
    [input.orgId],
  );
  const teamNumber = orgRow.rows[0]?.teamNumber ?? null;

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "matching_gift_finder",
    requestId: `matching-gift-finder-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: { contactId: input.contactId, programId: input.programId, seasonYear: input.seasonYear },
    invoke: async () => {
      const letter = buildDraftLetter({
        contactName,
        employerName: program.employerName,
        matchRatio: program.matchRatio,
        teamNumber,
        seasonYear: input.seasonYear,
        minGiftUsd: program.minGiftUsd,
        maxGiftUsd: program.maxGiftUsd,
        submissionUrl: program.submissionUrl,
      });
      return {
        value: letter,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-matching-gift-finder-v1",
        provider: "vantage-local",
      };
    },
  });

  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO matching_gift_finder_drafts (org_id, contact_id, program_id, subject, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, created_at AS "createdAt"`,
    [input.orgId, input.contactId, input.programId, result.subject, result.body, input.userId],
  );

  return {
    id: inserted.rows[0]!.id,
    contactId: input.contactId,
    contactName,
    programId: input.programId,
    employerName: program.employerName,
    subject: result.subject,
    body: result.body,
    createdAt: inserted.rows[0]!.createdAt,
  };
}
