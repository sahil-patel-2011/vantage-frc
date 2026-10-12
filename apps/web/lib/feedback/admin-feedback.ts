/**
 * The operator side of Send feedback: the /admin Feedback list, its filters, and the status
 * change. Everything runs through withRls as a platform admin (bug_reports_platform_admin,
 * 0449); a member never reaches this module's SQL because the routes refuse first.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { isBugKind, type BugKind } from "./bug-report";

export const FEEDBACK_STATUSES = ["new", "triaged", "fixed", "wont_fix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  fixed: "Fixed",
  wont_fix: "Won't fix",
};

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

/** Problems / Ideas in the words the filter shows (the stored kinds are bug / idea). */
export const FEEDBACK_KIND_FILTER_LABELS: Record<BugKind, string> = { bug: "Problems", idea: "Ideas" };

/** The newest this many are listed; the page says so when there are more. */
export const FEEDBACK_LIST_LIMIT = 200;

export type FeedbackFilters = { kind: BugKind | null; status: FeedbackStatus | null };

/** An unknown or missing value means "all": a stale bookmark shows everything, never nothing. */
export function parseFeedbackFilters(params: URLSearchParams): FeedbackFilters {
  const kind = params.get("kind");
  const status = params.get("status");
  return {
    kind: isBugKind(kind) ? kind : null,
    status: isFeedbackStatus(status) ? status : null,
  };
}

export type FeedbackItem = {
  id: string;
  kind: BugKind;
  status: FeedbackStatus;
  description: string;
  severity: string | null;
  route: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  createdAt: string;
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  reporterName: string | null;
  reporterEmail: string | null;
};

export type FeedbackCounts = {
  /** Notes still waiting for a first look, of either kind. */
  newTotal: number;
  byKind: Record<BugKind, number>;
  byStatus: Record<FeedbackStatus, number>;
  total: number;
};

type ListRow = {
  id: string;
  kind: string;
  status: string;
  description: string;
  severity: string | null;
  route: string | null;
  clientInfo: unknown;
  createdAt: Date | string;
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  reporterName: string | null;
  reporterEmail: string | null;
};

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function mapFeedbackRow(row: ListRow): FeedbackItem {
  const info = row.clientInfo && typeof row.clientInfo === "object" ? (row.clientInfo as Record<string, unknown>) : {};
  return {
    id: row.id,
    kind: isBugKind(row.kind) ? row.kind : "bug",
    status: isFeedbackStatus(row.status) ? row.status : "new",
    description: row.description,
    severity: row.severity,
    route: row.route,
    viewportWidth: positiveInt(info.viewportWidth),
    viewportHeight: positiveInt(info.viewportHeight),
    createdAt: new Date(row.createdAt).toISOString(),
    orgId: row.orgId,
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    reporterName: row.reporterName,
    reporterEmail: row.reporterEmail,
  };
}

/** Newest first. One more than the limit is read so the page can say "there are older ones". */
export async function listAdminFeedback(
  client: PoolClient,
  filters: FeedbackFilters,
): Promise<{ items: FeedbackItem[]; hasMore: boolean }> {
  const rows = await client.query<ListRow>(
    `SELECT b.id,
            b.kind,
            b.status,
            b.description,
            b.severity,
            b.route,
            b.client_info AS "clientInfo",
            b.created_at AS "createdAt",
            b.org_id AS "orgId",
            o.name AS "orgName",
            o.team_number AS "teamNumber",
            u.name AS "reporterName",
            u.email AS "reporterEmail"
       FROM bug_reports b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN organizations o ON o.id = b.org_id
      WHERE ($1::text IS NULL OR b.kind = $1::text)
        AND ($2::text IS NULL OR b.status = $2::text)
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $3::int`,
    [filters.kind, filters.status, FEEDBACK_LIST_LIMIT + 1],
  );
  return {
    items: rows.rows.slice(0, FEEDBACK_LIST_LIMIT).map(mapFeedbackRow),
    hasMore: rows.rows.length > FEEDBACK_LIST_LIMIT,
  };
}

/** Totals across every note, whatever the list is filtered to, so the filters can show counts. */
export async function feedbackCounts(client: PoolClient): Promise<FeedbackCounts> {
  const result = await client.query<{ kind: string; status: string; count: number }>(
    `SELECT kind, status, count(*)::int AS count FROM bug_reports GROUP BY kind, status`,
  );
  const counts: FeedbackCounts = {
    newTotal: 0,
    total: 0,
    byKind: { bug: 0, idea: 0 },
    byStatus: { new: 0, triaged: 0, fixed: 0, wont_fix: 0 },
  };
  for (const row of result.rows) {
    if (!isBugKind(row.kind) || !isFeedbackStatus(row.status)) continue;
    counts.total += row.count;
    counts.byKind[row.kind] += row.count;
    counts.byStatus[row.status] += row.count;
  }
  counts.newTotal = counts.byStatus.new;
  return counts;
}

/** Just the number the admin tabs show beside "Feedback". */
export async function countNewFeedback(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM bug_reports WHERE status = 'new'`,
  );
  return result.rows[0]?.count ?? 0;
}

export type FeedbackStatusChange = {
  id: string;
  kind: BugKind;
  status: FeedbackStatus;
  orgId: string | null;
  reporterId: string;
};

/** Returns null when no such note exists (or it is not visible, which for an admin is the same). */
export async function setFeedbackStatus(
  client: PoolClient,
  input: { id: string; status: FeedbackStatus },
): Promise<FeedbackStatusChange | null> {
  const result = await client.query<{ id: string; kind: string; status: string; orgId: string | null; userId: string }>(
    `UPDATE bug_reports
        SET status = $2::text
      WHERE id = $1::uuid
      RETURNING id, kind, status, org_id AS "orgId", user_id AS "userId"`,
    [input.id, input.status],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: isBugKind(row.kind) ? row.kind : "bug",
    status: isFeedbackStatus(row.status) ? row.status : input.status,
    orgId: row.orgId,
    reporterId: row.userId,
  };
}

/**
 * Fired on window by the Feedback view whenever it learns how many notes are new, so the
 * admin tabs (rendered once by the layout) show the number the operator just changed.
 */
export const ADMIN_FEEDBACK_NEW_EVENT = "vantage:admin-feedback-new";

/** The number beside "Feedback" in the admin tabs: nothing at zero, "99+" past two digits. */
export function newFeedbackBadge(count: number | null | undefined): string {
  if (!count || !Number.isFinite(count) || count < 1) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** "390 × 844", or null when the note carried no screen size. */
export function formatScreenSize(width: number | null, height: number | null): string | null {
  return width && height ? `${width} × ${height}` : null;
}
