/**
 * REIMBURSEMENTS — the money a team already spent that nothing was tracking.
 *
 * A parent buys a $180 gearbox on their own card at 11pm, photographs the
 * receipt, and waits. Before 0482 that claim lived in a text thread: the
 * treasurer had no queue, no receipt, no record of when it was approved, and
 * the team's balance stayed wrong until the cheque cleared.
 *
 * This module is the PURE half — statuses, the transition table, validation,
 * and the receipt size rules. Everything here is unit-tested and has no DB or
 * DOM dependency; the SQL lives alongside it in the same file only as exported
 * constants + thin client-taking functions, following lib/finance/ledger.ts.
 *
 * Honesty rules baked in:
 *  - Only a PAID claim mirrors into finance_transactions (source_kind
 *    'reimbursement'). An approved-but-unpaid claim is a promise, not cash —
 *    counting it would overstate what the team has spent.
 *  - Un-paying a claim removes the mirror row in the SAME transaction, so the
 *    ledger can never keep money the source row no longer claims.
 *  - Receipt presence is reported as a fact, never assumed. A claim with no
 *    photo says so.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { recordMoney, removeMoney } from "./ledger";
import { FINANCE_MANAGER_REQUIRED } from "./finance-managers";

export const REIMBURSEMENT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "denied",
  "paid",
] as const;

export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export function isReimbursementStatus(value: unknown): value is ReimbursementStatus {
  return typeof value === "string" && (REIMBURSEMENT_STATUSES as readonly string[]).includes(value);
}

export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved — not paid yet",
  denied: "Denied",
  paid: "Paid",
};

/**
 * One line telling the filer what actually happens next, per status. Someone who manages money
 * looking at another person's claim reads REIMBURSEMENT_REVIEWER_HINTS instead: "only you can see
 * this" is true on your own draft and false on a row in the approval queue.
 */
export const REIMBURSEMENT_STATUS_HINTS: Record<ReimbursementStatus, string> = {
  draft: "Only you and the people who manage money can see this. Submit it when the PDF receipt is attached.",
  submitted: "The people who manage your team's money see it in their approval queue.",
  approved: "Approved. It counts against the team balance once it is marked paid.",
  denied: "Not approved. Read the note, fix the claim, and submit it again.",
  paid: "Paid out and recorded in the team ledger.",
};

/** The same statuses as read by someone who manages money, on another person's claim. */
export const REIMBURSEMENT_REVIEWER_HINTS: Record<ReimbursementStatus, string> = {
  draft: "Still a draft. The person who filed it submits it once the receipt is attached.",
  submitted: "Waiting for a decision.",
  approved: "Approved. Mark it paid once the money has gone back to them.",
  denied: "Denied. The person who filed it can fix it and submit it again.",
  paid: "Paid out and recorded in the team ledger.",
};

export function reimbursementHint(status: ReimbursementStatus, viewer: { isOwnClaim: boolean }): string {
  return viewer.isOwnClaim ? REIMBURSEMENT_STATUS_HINTS[status] : REIMBURSEMENT_REVIEWER_HINTS[status];
}

/**
 * Who may drive each transition. 'member' is the claim's own filer; 'admin' is
 * the treasurer — a finance manager (0714: the team owner, or someone the owner
 * chose to manage money), NOT every org admin. Anything not listed here is
 * impossible — the API refuses it before touching the database, and RLS
 * (can_manage_finances) refuses it again.
 *
 * Two people, always (0723): a finance manager never approves, denies or pays a
 * claim they filed, and only the filer submits, withdraws or reopens their own
 * claim. When the owner is the team's only finance manager, the owner's own
 * claims wait until the owner gives a second person "Manage money".
 */
export type ReimbursementActor = "member" | "admin";

export type ReimbursementAction =
  | "submit"
  | "withdraw"
  | "approve"
  | "deny"
  | "mark_paid"
  | "unmark_paid"
  | "reopen";

type Transition = {
  from: readonly ReimbursementStatus[];
  to: ReimbursementStatus;
  actors: readonly ReimbursementActor[];
  /** The filer's own move. Nobody submits, withdraws or reopens a claim for them. */
  filerOnly?: true;
  /** A decision about the money. Never made by the person who filed the claim. */
  decision?: true;
  /** Audit-log action string. Members may only append 'reimbursement.*' rows. */
  audit: string;
};

export const REIMBURSEMENT_TRANSITIONS: Record<ReimbursementAction, Transition> = {
  submit: { from: ["draft", "denied"], to: "submitted", actors: ["member", "admin"], filerOnly: true, audit: "reimbursement.submitted" },
  withdraw: { from: ["submitted"], to: "draft", actors: ["member", "admin"], filerOnly: true, audit: "reimbursement.withdrawn" },
  approve: { from: ["submitted", "denied"], to: "approved", actors: ["admin"], decision: true, audit: "reimbursement.approved" },
  deny: { from: ["submitted", "approved"], to: "denied", actors: ["admin"], decision: true, audit: "reimbursement.denied" },
  mark_paid: { from: ["approved"], to: "paid", actors: ["admin"], decision: true, audit: "reimbursement.paid" },
  unmark_paid: { from: ["paid"], to: "approved", actors: ["admin"], decision: true, audit: "reimbursement.payment_undone" },
  reopen: { from: ["denied"], to: "draft", actors: ["member", "admin"], filerOnly: true, audit: "reimbursement.reopened" },
};

/** Where a claim is, in words, for "This claim is …, so it can't be …". */
const STATUS_PHRASES: Record<ReimbursementStatus, string> = {
  draft: "still a draft",
  submitted: "waiting for a decision",
  approved: "approved but not paid yet",
  denied: "denied",
  paid: "already paid",
};

const ACTION_PHRASES: Record<ReimbursementAction, string> = {
  submit: "submitted",
  withdraw: "withdrawn",
  approve: "approved",
  deny: "denied",
  mark_paid: "marked paid",
  unmark_paid: "marked unpaid",
  reopen: "reopened",
};

/** Said when a finance manager tries to decide or pay a claim they filed. */
export const OWN_CLAIM_DECISION =
  "Someone else who manages money has to decide on a claim you filed. If you are the only one, the team owner can give a second person Manage money in Team admin.";

/** A denial needs a reason the filer can act on; shorter notes are refused. */
export const MIN_DENIAL_NOTE_LENGTH = 3;

/** Null when the note is a usable reason for a denial, otherwise the sentence to show. */
export function denialNoteProblem(note: unknown): string | null {
  const text = typeof note === "string" ? note.trim() : "";
  return text.length >= MIN_DENIAL_NOTE_LENGTH
    ? null
    : "Say why the claim is denied, so the person who filed it knows what to fix.";
}

export function isReimbursementAction(value: unknown): value is ReimbursementAction {
  return typeof value === "string" && Object.hasOwn(REIMBURSEMENT_TRANSITIONS, value);
}

export type TransitionVerdict =
  | { ok: true; to: ReimbursementStatus; audit: string }
  | { ok: false; reason: string };

/**
 * The single authority on "can this person move this claim there". Returns a
 * reason a human can act on, never a bare false.
 */
export function evaluateTransition(input: {
  action: ReimbursementAction;
  from: ReimbursementStatus;
  actor: ReimbursementActor;
  /** True when the actor filed the claim. Admins may act on anyone's. */
  isOwnClaim: boolean;
  hasReceipt: boolean;
}): TransitionVerdict {
  const transition = REIMBURSEMENT_TRANSITIONS[input.action];
  if (!transition) return { ok: false, reason: "Unknown reimbursement action." };
  if (input.actor === "member" && !input.isOwnClaim) {
    return { ok: false, reason: "You can only change reimbursements you filed." };
  }
  if (!transition.actors.includes(input.actor)) {
    return { ok: false, reason: FINANCE_MANAGER_REQUIRED };
  }
  // The two-person rule. RLS (0723) refuses the same write if this is bypassed.
  if (transition.decision && input.isOwnClaim) return { ok: false, reason: OWN_CLAIM_DECISION };
  if (transition.filerOnly && !input.isOwnClaim) {
    return { ok: false, reason: "Only the person who filed this claim can do that." };
  }
  if (!transition.from.includes(input.from)) {
    return {
      ok: false,
      reason: `This claim is ${STATUS_PHRASES[input.from]}, so it can't be ${ACTION_PHRASES[input.action]}.`,
    };
  }
  // Submitting without a receipt is the single most common cause of a claim
  // bouncing back, so it is blocked at the source instead of denied later.
  if (input.action === "submit" && !input.hasReceipt) {
    return { ok: false, reason: "Attach the receipt as a PDF before submitting." };
  }
  return { ok: true, to: transition.to, audit: transition.audit };
}

/** Actions the UI should offer for a claim, in the order they should appear. */
export function availableActions(input: {
  status: ReimbursementStatus;
  actor: ReimbursementActor;
  isOwnClaim: boolean;
  hasReceipt: boolean;
}): ReimbursementAction[] {
  const order: ReimbursementAction[] = [
    "submit",
    "approve",
    "mark_paid",
    "deny",
    "withdraw",
    "unmark_paid",
    "reopen",
  ];
  return order.filter(
    (action) => evaluateTransition({ ...input, action, from: input.status }).ok,
  );
}

// ---------------------------------------------------------------- receipts

/**
 * Server-side receipt cap. Matches the reimbursement_requests.receipt_byte_size
 * CHECK in 0482 — anything larger is refused by the API before the INSERT so a
 * constraint violation can never be what the member sees.
 */
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

/**
 * Receipt documents remain supported after photo/video storage retirement (0700: the database
 * refuses new image receipts), so every sentence about receipts says PDF, and RECEIPT_PDF_HELP
 * tells a student holding a phone photo how to make one.
 */
export const RECEIPT_MEDIA_TYPES = ["application/pdf"] as const;

/** How to turn a paper receipt into a PDF with the phone already in hand. */
export const RECEIPT_PDF_HELP =
  "Only have a photo? Scan the receipt to a PDF with your phone: Notes or Files › Scan Documents on an iPhone, Google Drive › Scan on Android.";

export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

export function isReceiptMediaType(value: unknown): value is ReceiptMediaType {
  return typeof value === "string" && (RECEIPT_MEDIA_TYPES as readonly string[]).includes(value);
}

export type ReceiptVerdict = { ok: true; mediaType: ReceiptMediaType } | { ok: false; reason: string };

export function evaluateReceiptUpload(input: {
  mediaType: string | null | undefined;
  byteSize: number;
}): ReceiptVerdict {
  if (!isReceiptMediaType(input.mediaType)) {
    return { ok: false, reason: "Attach the receipt as a PDF. Photos can't be uploaded: scan the receipt to a PDF with your phone instead." };
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, reason: "That file is empty. Choose the receipt PDF and try again." };
  }
  if (input.byteSize > MAX_RECEIPT_BYTES) {
    return {
      ok: false,
      reason: `That document is ${formatBytes(input.byteSize)} — over the ${formatBytes(MAX_RECEIPT_BYTES)} limit. Export a smaller PDF.`,
    };
  }
  return { ok: true, mediaType: input.mediaType };
}

/** MIME labels alone do not establish that a file is a PDF. */
export function isPdfReceiptBytes(bytes: Uint8Array): boolean {
  const decode = (part: Uint8Array) => new TextDecoder().decode(part);
  return /^%PDF-1\.[0-9]|^%PDF-2\.[0-9]/.test(decode(bytes.subarray(0, 8)))
    && decode(bytes.subarray(Math.max(0, bytes.length - 2048))).includes("%%EOF");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- claim input

export type ClaimDraft = {
  amountUsd: number;
  description: string;
  categoryId: string | null;
  purchasedOn: string | null;
  seasonYear: number;
};

export type ClaimDraftVerdict = { ok: true; value: ClaimDraft } | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Validate a member-typed claim. The amount is dollars and cents exactly: a third decimal is
 * refused rather than rounded, so the amount on file is the amount typed. A purchase can't be in
 * the future (one day of slack for time zones). Money is never invented.
 */
export function normalizeClaimDraft(input: {
  amountUsd: unknown;
  description: unknown;
  categoryId?: unknown;
  purchasedOn?: unknown;
  seasonYear?: unknown;
  now?: Date;
}): ClaimDraftVerdict {
  const amountRaw = typeof input.amountUsd === "string" ? Number(input.amountUsd) : input.amountUsd;
  if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw)) {
    return { ok: false, reason: "Enter the amount you paid." };
  }
  const cents = Math.round(amountRaw * 100);
  if (cents <= 0) return { ok: false, reason: "The amount must be more than $0." };
  if (cents > 100_000_000) return { ok: false, reason: "That amount is too large to record here." };
  if (Math.abs(amountRaw * 100 - cents) > 1e-6) return { ok: false, reason: "Use dollars and cents, like 12.34." };

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) return { ok: false, reason: "Say what the money was spent on." };
  if (description.length > 500) return { ok: false, reason: "Keep the description under 500 characters." };

  const categoryId = isUuid(input.categoryId) ? input.categoryId : null;

  const now = input.now ?? new Date();
  let purchasedOn: string | null = null;
  if (typeof input.purchasedOn === "string" && input.purchasedOn.trim()) {
    const value = input.purchasedOn.trim();
    if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
      return { ok: false, reason: "Use a real purchase date (YYYY-MM-DD)." };
    }
    const latest = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (value > latest) return { ok: false, reason: "The purchase date can't be in the future." };
    purchasedOn = value;
  }

  const seasonRaw = Number(input.seasonYear);
  const seasonYear =
    Number.isFinite(seasonRaw) && seasonRaw >= 1992 && seasonRaw <= 3000
      ? Math.round(seasonRaw)
      : currentSeasonYear(now);

  return { ok: true, value: { amountUsd: cents / 100, description, categoryId, purchasedOn, seasonYear } };
}

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

// ---------------------------------------------------------------- view model

export type ReimbursementSummary = {
  id: string;
  seasonYear: number;
  memberUserId: string;
  memberName: string | null;
  amountUsd: number;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  purchasedOn: string | null;
  status: ReimbursementStatus;
  decisionNote: string | null;
  approverName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  hasReceipt: boolean;
  receiptByteSize: number | null;
  receiptChecksum: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReimbursementTotals = {
  awaitingDecisionUsd: number;
  awaitingDecisionCount: number;
  approvedUnpaidUsd: number;
  approvedUnpaidCount: number;
  paidUsd: number;
  paidCount: number;
};

/**
 * The three numbers a treasurer needs: what is waiting on them, what they owe
 * but have not sent, and what has actually left the account. Every bucket is
 * counted from real rows — an empty queue reports zero, never a placeholder.
 */
export function summarizeReimbursements(rows: readonly ReimbursementSummary[]): ReimbursementTotals {
  let awaitingCents = 0;
  let awaitingCount = 0;
  let approvedCents = 0;
  let approvedCount = 0;
  let paidCents = 0;
  let paidCount = 0;
  for (const row of rows) {
    const cents = Math.round(row.amountUsd * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    if (row.status === "submitted") {
      awaitingCents += cents;
      awaitingCount += 1;
    } else if (row.status === "approved") {
      approvedCents += cents;
      approvedCount += 1;
    } else if (row.status === "paid") {
      paidCents += cents;
      paidCount += 1;
    }
  }
  return {
    awaitingDecisionUsd: awaitingCents / 100,
    awaitingDecisionCount: awaitingCount,
    approvedUnpaidUsd: approvedCents / 100,
    approvedUnpaidCount: approvedCount,
    paidUsd: paidCents / 100,
    paidCount: paidCount,
  };
}

export type ReimbursementsView =
  | { status: "setup_required"; message: string; orgId: string | null }
  | {
      status: "ready";
      orgId: string;
      seasonYear: number;
      /** True when the viewer is a finance manager (0714) and sees the whole queue. */
      isTreasurer: boolean;
      /** Same value, under the name every finance GET uses. */
      canManageFinances: boolean;
      /** False for a view-only member (0714): they can't file claims. */
      canFile: boolean;
      viewerUserId: string;
      requests: ReimbursementSummary[];
      totals: ReimbursementTotals;
      categories: { id: string; name: string }[];
      computedAt: string;
    };

/** Columns every read of a claim needs — deliberately never `receipt_bytes`. */
const SUMMARY_COLUMNS = `
  r.id::text AS id,
  r.season_year AS "seasonYear",
  r.member_user_id::text AS "memberUserId",
  m.name AS "memberName",
  r.amount_usd::text AS "amountUsd",
  r.description,
  r.category_id::text AS "categoryId",
  c.name AS "categoryName",
  r.purchased_on::text AS "purchasedOn",
  r.status,
  r.decision_note AS "decisionNote",
  a.name AS "approverName",
  r.submitted_at::text AS "submittedAt",
  r.decided_at::text AS "decidedAt",
  r.paid_at::text AS "paidAt",
  (r.receipt_bytes IS NOT NULL) AS "hasReceipt",
  r.receipt_byte_size AS "receiptByteSize",
  r.receipt_checksum_sha256 AS "receiptChecksum",
  r.created_at::text AS "createdAt",
  r.updated_at::text AS "updatedAt"`;

export const REIMBURSEMENT_LIST_SQL = `
  SELECT ${SUMMARY_COLUMNS}
  FROM reimbursement_requests r
  LEFT JOIN users m ON m.id = r.member_user_id
  LEFT JOIN users a ON a.id = r.approver_user_id
  LEFT JOIN finance_categories c ON c.id = r.category_id AND c.org_id = r.org_id
  WHERE r.org_id = $1::uuid
  ORDER BY
    CASE r.status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 WHEN 'draft' THEN 2
                  WHEN 'denied' THEN 3 ELSE 4 END,
    r.created_at DESC
  LIMIT 500`;

export const REIMBURSEMENT_ONE_SQL = `
  SELECT ${SUMMARY_COLUMNS}
  FROM reimbursement_requests r
  LEFT JOIN users m ON m.id = r.member_user_id
  LEFT JOIN users a ON a.id = r.approver_user_id
  LEFT JOIN finance_categories c ON c.id = r.category_id AND c.org_id = r.org_id
  WHERE r.org_id = $1::uuid AND r.id = $2::uuid`;

type SummaryRow = Omit<ReimbursementSummary, "amountUsd" | "status" | "hasReceipt"> & {
  amountUsd: string | number;
  status: string;
  hasReceipt: boolean;
};

export function mapSummaryRow(row: SummaryRow): ReimbursementSummary {
  const amount = Number(row.amountUsd ?? 0);
  return {
    ...row,
    amountUsd: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    status: isReimbursementStatus(row.status) ? row.status : "draft",
    hasReceipt: Boolean(row.hasReceipt),
  };
}

/** 42P01 undefined_table / 42703 undefined_column both mean "run migrations". */
export function isMissingRelationOrColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "42P01" || code === "42703";
}

/**
 * Load the queue the caller is allowed to see. RLS already restricts a
 * non-admin to their own rows (0482), so the same SQL serves both roles —
 * `isTreasurer` only changes what the UI offers, never what the DB returns.
 */
export async function computeReimbursementsView(
  client: PoolClient,
  input: { orgId: string; userId: string; isTreasurer: boolean; seasonYear: number; canFile?: boolean },
): Promise<ReimbursementsView> {
  try {
    const [requests, categories] = await Promise.all([
      client.query(REIMBURSEMENT_LIST_SQL, [input.orgId]),
      client.query<{ id: string; name: string }>(
        `SELECT id::text AS id, name FROM finance_categories
         WHERE org_id = $1::uuid AND season_year = $2::int
         ORDER BY name
         LIMIT 200`,
        [input.orgId, input.seasonYear],
      ),
    ]);
    const rows = requests.rows.map((row) => mapSummaryRow(row as never));
    return {
      status: "ready",
      orgId: input.orgId,
      seasonYear: input.seasonYear,
      isTreasurer: input.isTreasurer,
      canManageFinances: input.isTreasurer,
      canFile: input.canFile !== false,
      viewerUserId: input.userId,
      requests: rows,
      totals: summarizeReimbursements(rows),
      categories: categories.rows,
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (isMissingRelationOrColumn(error)) {
      return {
        status: "setup_required",
        message: "Reimbursements are not set up yet. Run database migrations, then reload.",
        orgId: input.orgId,
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------- audit trail

/**
 * Audit payloads are deliberately THIN. finance_audit_log is member-readable
 * org-wide (0035), while reimbursement rows are not — putting a claim's
 * description or the filer's identity in the log would leak through the back
 * door what the row policies keep private. The claim id is enough for a
 * treasurer, who can read the row itself, to reconstruct everything.
 */
export function auditPayload(input: {
  reimbursementId: string;
  status: ReimbursementStatus;
  amountUsd: number;
}): { reimbursementId: string; status: ReimbursementStatus; amountUsd: number } {
  return {
    reimbursementId: input.reimbursementId,
    status: input.status,
    amountUsd: Math.round(input.amountUsd * 100) / 100,
  };
}

export async function writeReimbursementAudit(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    action: string;
    before: ReturnType<typeof auditPayload> | null;
    after: ReturnType<typeof auditPayload> | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO finance_audit_log(org_id, actor_user_id, action, before, after)
     VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb)`,
    [
      input.orgId,
      input.actorUserId,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ],
  );
}

// ---------------------------------------------------------------- ledger mirror

/**
 * The ledger description for a paid claim.
 *
 * DELIBERATELY WITHOUT THE MEMBER'S NAME. finance_transactions is readable by
 * every org member (0035), while reimbursement_requests is not (0482) — putting
 * "(Jane Doe)" in the mirror label would publish through the ledger exactly the
 * association the row policies keep private. What the team bought is ledger
 * information; whose card it was is not. source_id still points at the claim, so
 * a treasurer (who can read the row) loses nothing.
 */
export function mirrorLabel(input: { description: string }): string {
  return `Reimbursement — ${input.description}`.slice(0, 500);
}

/**
 * Sync the unified-ledger mirror for one claim. PAID mirrors as cash out; every
 * other status removes the mirror, so undoing a payment cannot leave money in
 * the ledger the claim no longer says was spent. Call inside the SAME withRls
 * transaction as the status write (the 0461 contract).
 */
export async function syncReimbursementMirror(
  client: PoolClient,
  input: {
    orgId: string;
    reimbursementId: string;
    status: ReimbursementStatus;
    amountUsd: number;
    seasonYear: number;
    categoryId: string | null;
    description: string;
    paidAt: string | Date | null;
    actorUserId: string;
  },
): Promise<void> {
  if (input.status !== "paid") {
    await removeMoney(client, {
      orgId: input.orgId,
      source: "reimbursement",
      sourceId: input.reimbursementId,
    });
    return;
  }
  await recordMoney(client, {
    orgId: input.orgId,
    source: "reimbursement",
    sourceId: input.reimbursementId,
    direction: "out",
    amountUsd: input.amountUsd,
    seasonYear: input.seasonYear,
    categoryId: input.categoryId,
    label: mirrorLabel({ description: input.description }),
    occurredAt: input.paidAt,
    createdBy: input.actorUserId,
    countsInBalance: true,
  });
}
