import type { PoolClient } from "@neondatabase/serverless";
import { summarizePartsRelay } from ".";
import type {
  PartsRelayCategory,
  PartsRelayCondition,
  PartsRelayListing,
  PartsRelayListingStatus,
  PartsRelayListingType,
  PartsRelayLoan,
  PartsRelayLoanDirection,
  PartsRelayLoanStatus,
  PartsRelaySummary,
} from "./types";

export const PARTS_RELAY_CATEGORIES: PartsRelayCategory[] = [
  "electrical",
  "mechanical",
  "pneumatic",
  "electronics",
  "fasteners",
  "battery",
  "wheels",
  "other",
];
export const PARTS_RELAY_CONDITIONS: PartsRelayCondition[] = ["new", "used", "any"];
export const PARTS_RELAY_LISTING_TYPES: PartsRelayListingType[] = ["need", "offer"];
export const PARTS_RELAY_LISTING_STATUSES: PartsRelayListingStatus[] = ["open", "matched", "fulfilled", "cancelled"];
export const PARTS_RELAY_LOAN_DIRECTIONS: PartsRelayLoanDirection[] = ["lending", "borrowing"];
export const PARTS_RELAY_LOAN_STATUSES: PartsRelayLoanStatus[] = ["active", "returned", "overdue", "lost"];

export type PartsRelaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PartsRelayView =
  | {
      status: "setup_required";
      message: string;
      steps: PartsRelaySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      listings: PartsRelayListing[];
      loans: PartsRelayLoan[];
      summary: PartsRelaySummary;
      computedAt: string;
    };

type ListingRow = {
  id: string;
  listingType: PartsRelayListingType;
  partName: string;
  category: PartsRelayCategory;
  quantity: number;
  condition: PartsRelayCondition;
  eventKey: string | null;
  notes: string | null;
  status: PartsRelayListingStatus;
  createdAt: string;
};

type LoanRow = {
  id: string;
  listingId: string | null;
  direction: PartsRelayLoanDirection;
  counterpartyTeam: string;
  partName: string;
  quantity: number;
  eventKey: string | null;
  loanedOn: string;
  dueBackOn: string | null;
  returnedOn: string | null;
  status: PartsRelayLoanStatus;
  notes: string | null;
  createdAt: string;
};

function mapListing(row: ListingRow): PartsRelayListing {
  return {
    id: row.id,
    listingType: row.listingType,
    partName: row.partName,
    category: row.category,
    quantity: Number(row.quantity) || 1,
    condition: row.condition,
    eventKey: row.eventKey,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function mapLoan(row: LoanRow): PartsRelayLoan {
  return {
    id: row.id,
    listingId: row.listingId,
    direction: row.direction,
    counterpartyTeam: row.counterpartyTeam,
    partName: row.partName,
    quantity: Number(row.quantity) || 1,
    eventKey: row.eventKey,
    loanedOn: row.loanedOn,
    dueBackOn: row.dueBackOn,
    returnedOn: row.returnedOn,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
  };
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

export async function computePartsRelayView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<PartsRelayView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to post and track parts relay listings.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [listingResult, loanResult] = await Promise.all([
    client.query<ListingRow>(
      `SELECT id, listing_type AS "listingType", part_name AS "partName", category, quantity,
              condition, event_key AS "eventKey", notes, status, created_at AS "createdAt"
       FROM parts_relay_listings
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
    client.query<LoanRow>(
      `SELECT id, listing_id AS "listingId", direction, counterparty_team AS "counterpartyTeam",
              part_name AS "partName", quantity, event_key AS "eventKey",
              loaned_on::text AS "loanedOn", due_back_on::text AS "dueBackOn",
              returned_on::text AS "returnedOn", status, notes, created_at AS "createdAt"
       FROM parts_relay_loans
       WHERE org_id = $1
       ORDER BY loaned_on DESC, created_at DESC`,
      [org.orgId],
    ),
  ]);

  const listings = listingResult.rows.map(mapListing);
  const loans = loanResult.rows.map(mapLoan);
  const summary = summarizePartsRelay(listings, loans);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    listings,
    loans,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createListing(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    listingType: PartsRelayListingType;
    partName: string;
    category: PartsRelayCategory;
    quantity: number;
    condition: PartsRelayCondition;
    eventKey: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO parts_relay_listings (
       org_id, listing_type, part_name, category, quantity, condition, event_key, notes, posted_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.listingType,
      input.partName,
      input.category,
      Math.max(1, Math.round(input.quantity)),
      input.condition,
      input.eventKey,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateListingStatus(
  client: PoolClient,
  input: { orgId: string; listingId: string; status: PartsRelayListingStatus },
): Promise<void> {
  await client.query(
    `UPDATE parts_relay_listings SET status = $1 WHERE id = $2 AND org_id = $3`,
    [input.status, input.listingId, input.orgId],
  );
}

export async function deleteListing(
  client: PoolClient,
  input: { orgId: string; listingId: string },
): Promise<void> {
  await client.query(`DELETE FROM parts_relay_listings WHERE id = $1 AND org_id = $2`, [
    input.listingId,
    input.orgId,
  ]);
}

export async function logLoan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    listingId: string | null;
    direction: PartsRelayLoanDirection;
    counterpartyTeam: string;
    partName: string;
    quantity: number;
    eventKey: string | null;
    loanedOn: string;
    dueBackOn: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO parts_relay_loans (
       org_id, listing_id, direction, counterparty_team, part_name, quantity, event_key,
       loaned_on, due_back_on, notes, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11)`,
    [
      input.orgId,
      input.listingId,
      input.direction,
      input.counterpartyTeam,
      input.partName,
      Math.max(1, Math.round(input.quantity)),
      input.eventKey,
      input.loanedOn,
      input.dueBackOn,
      input.notes,
      input.userId,
    ],
  );
}

export async function markLoanReturned(
  client: PoolClient,
  input: { orgId: string; loanId: string; returnedOn: string },
): Promise<void> {
  await client.query(
    `UPDATE parts_relay_loans SET status = 'returned', returned_on = $1::date WHERE id = $2 AND org_id = $3`,
    [input.returnedOn, input.loanId, input.orgId],
  );
}

export async function markLoanLost(
  client: PoolClient,
  input: { orgId: string; loanId: string },
): Promise<void> {
  await client.query(`UPDATE parts_relay_loans SET status = 'lost' WHERE id = $1 AND org_id = $2`, [
    input.loanId,
    input.orgId,
  ]);
}

export async function deleteLoan(
  client: PoolClient,
  input: { orgId: string; loanId: string },
): Promise<void> {
  await client.query(`DELETE FROM parts_relay_loans WHERE id = $1 AND org_id = $2`, [input.loanId, input.orgId]);
}
