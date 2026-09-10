import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_AUTO_CLOSE_AFTER_HOURS,
  DEFAULT_AUTO_CLOSE_CREDIT_HOURS,
  describeAutoClosePlan,
  normalizeAutoClosePolicy,
  planAutoClose,
  type OpenSession,
} from "../../../../lib/hours/auto-close";
import type { MemberHoursTotal } from "../../../../lib/hours/eligibility";
import {
  parseKioskAction,
  type KioskAction,
  type KioskOpenSession,
  type KioskScanCodeRow,
  type KioskScanResult,
  type KioskView,
} from "../../../../lib/hours/kiosk";
import { maskScanCode, resolveOccurredAt, type ScanCodeKind } from "../../../../lib/hours/scan-codes";

export const runtime = "nodejs";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function membershipRole(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

const isAdmin = (role: string) => role === "owner" || role === "admin";

function requireAdmin(role: string) {
  if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Kiosk request failed" }, { status });
}

// The kiosk columns landed in 0457_hours_kiosk_scan.sql. A deployment that has
// not run the migration yet must degrade to "configure X", never crash.
function isMissingKioskSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "42P01" ||
    code === "42703" ||
    /member_scan_codes|kiosk_scan_events|auto_closed|auto_close_after_hours|travel_eligibility_hours/.test(
      message,
    )
  );
}

const ROUND2 = (value: number) => Math.round(value * 100) / 100;

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team to run the scan-in kiosk.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, userId: session.user.id },
        } satisfies KioskView;
      }

      const admin = isAdmin(row.role);

      const [policyRows, openRows, totalRows, codeRows] = await Promise.all([
        client.query<{
          afterHours: number;
          creditHours: number;
          travelEligibilityHours: number | null;
          seasonStart: string | null;
        }>(
          `SELECT auto_close_after_hours::float8 AS "afterHours",
                  auto_close_credit_hours::float8 AS "creditHours",
                  travel_eligibility_hours::float8 AS "travelEligibilityHours",
                  season_start::text AS "seasonStart"
           FROM hour_policies WHERE org_id = $1::uuid`,
          [row.orgId],
        ),
        client.query<KioskOpenSession>(
          `SELECT l.id, l.user_id AS "userId", u.name AS "userName", l.kind,
                  l.clock_in::text AS "clockIn"
           FROM hour_logs l
           JOIN users u ON u.id = l.user_id
           WHERE l.org_id = $1::uuid AND l.clock_out IS NULL
           ORDER BY l.clock_in ASC`,
          [row.orgId],
        ),
        client.query<MemberHoursTotal>(
          // A still-open session contributes only what the forgot-to-sign-out
          // sweep would eventually credit it. Without that cap, a student who
          // forgot to scan out at 9pm keeps accruing hours all night and the
          // travel-eligibility total reads as fact until a mentor happens to
          // sweep. Capping here makes the displayed total agree with the swept
          // total instead of inventing overnight shop time.
          `WITH pol AS (
             SELECT p.season_start,
                    p.auto_close_after_hours::float8 AS after_hours,
                    p.auto_close_credit_hours::float8 AS credit_hours
             FROM hour_policies p WHERE p.org_id = $1::uuid
           )
           SELECT m.user_id AS "userId", u.name, m.role,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN l.clock_out IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (l.clock_out - l.clock_in)) / 3600.0
                        WHEN EXTRACT(EPOCH FROM (now() - l.clock_in)) / 3600.0
                             > COALESCE((SELECT after_hours FROM pol), $2::float8)
                          THEN COALESCE((SELECT credit_hours FROM pol), $3::float8)
                        ELSE EXTRACT(EPOCH FROM (now() - l.clock_in)) / 3600.0
                      END
                    ),
                    0
                  )::float8 AS "totalHours",
                  COUNT(l.id)::int AS "sessions",
                  COUNT(l.id) FILTER (WHERE l.auto_closed)::int AS "autoClosedCount",
                  MIN(l.clock_in) FILTER (WHERE l.clock_out IS NULL)::text AS "openSince"
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN hour_logs l
             ON l.org_id = m.org_id
            AND l.user_id = m.user_id
            AND l.clock_in >= COALESCE(
                  (SELECT season_start::timestamptz FROM pol),
                  now() - interval '400 days'
                )
           WHERE m.org_id = $1::uuid
           GROUP BY m.user_id, u.name, m.role
           ORDER BY u.name ASC NULLS LAST`,
          [row.orgId, DEFAULT_AUTO_CLOSE_AFTER_HOURS, DEFAULT_AUTO_CLOSE_CREDIT_HOURS],
        ),
        client.query<{
          id: string;
          userId: string;
          userName: string | null;
          code: string;
          codeKind: ScanCodeKind;
          label: string;
          createdAt: string;
        }>(
          `SELECT c.id, c.user_id AS "userId", u.name AS "userName", c.code,
                  c.code_kind AS "codeKind", c.label, c.created_at::text AS "createdAt"
           FROM member_scan_codes c
           JOIN users u ON u.id = c.user_id
           WHERE c.org_id = $1::uuid
           ORDER BY u.name ASC NULLS LAST, c.created_at ASC`,
          [row.orgId],
        ),
      ]);

      const stored = policyRows.rows[0];
      const policy = normalizeAutoClosePolicy({
        afterHours: stored?.afterHours ?? null,
        creditHours: stored?.creditHours ?? null,
      });

      // Never render a full student ID on a wall-mounted screen.
      const scanCodes: KioskScanCodeRow[] = codeRows.rows.map((code) => ({
        id: code.id,
        userId: code.userId,
        userName: code.userName,
        maskedCode: maskScanCode(code.code),
        codeKind: code.codeKind,
        label: code.label,
        createdAt: code.createdAt,
      }));
      const enrolled = new Set(scanCodes.map((code) => code.userId));

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          userId: session.user.id,
        },
        policy: {
          ...policy,
          travelEligibilityHours: stored?.travelEligibilityHours ?? null,
          seasonStart: stored?.seasonStart ?? null,
        },
        openSessions: openRows.rows,
        totals: totalRows.rows.map((total) => ({ ...total, totalHours: ROUND2(total.totalHours) })),
        // RLS already restricts non-admins to their own row; blank the list
        // entirely so a member-run kiosk never renders roster card metadata.
        scanCodes: admin ? scanCodes : [],
        unenrolledCount: totalRows.rows.filter((total) => !enrolled.has(total.userId)).length,
      } satisfies KioskView;
    });

    return Response.json(view);
  } catch (error) {
    if (isMissingKioskSchema(error)) {
      return Response.json(
        {
          error:
            "Scan-in kiosk tables are not migrated yet — run migration 0457_hours_kiosk_scan.sql, then reload.",
        },
        { status: 503 },
      );
    }
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseKioskAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const role = await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "scan":
          return scanAction(client, { action, callerId: userId, role });

        case "enroll_code": {
          requireAdmin(role);
          const member = await client.query(
            `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
            [action.orgId, action.userId],
          );
          if (!member.rowCount) throw new HttpError(400, "That member is not in this organization");
          const existing = await client.query<{ userName: string | null }>(
            `SELECT u.name AS "userName" FROM member_scan_codes c
             JOIN users u ON u.id = c.user_id
             WHERE c.org_id = $1::uuid AND c.code = $2`,
            [action.orgId, action.code],
          );
          if (existing.rowCount) {
            throw new HttpError(
              409,
              `That code is already enrolled to ${existing.rows[0]!.userName ?? "another member"}.`,
            );
          }
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO member_scan_codes (org_id, user_id, code, code_kind, label, created_by)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
             RETURNING id`,
            [action.orgId, action.userId, action.code, action.codeKind, action.label, userId],
          );
          return { id: inserted.rows[0]!.id, maskedCode: maskScanCode(action.code) };
        }

        case "remove_code": {
          requireAdmin(role);
          const deleted = await client.query(
            `DELETE FROM member_scan_codes WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Scan code not found");
          return { ok: true };
        }

        case "auto_close_sweep":
          requireAdmin(role);
          return sweepAction(client, { orgId: action.orgId, callerId: userId });

        case "set_kiosk_policy": {
          requireAdmin(role);
          await client.query(
            `INSERT INTO hour_policies
               (org_id, auto_close_after_hours, auto_close_credit_hours, travel_eligibility_hours, updated_by, updated_at)
             VALUES ($1::uuid, $2, $3, $4, $5::uuid, now())
             ON CONFLICT (org_id) DO UPDATE SET
               auto_close_after_hours = excluded.auto_close_after_hours,
               auto_close_credit_hours = excluded.auto_close_credit_hours,
               travel_eligibility_hours = excluded.travel_eligibility_hours,
               updated_by = excluded.updated_by,
               updated_at = now()`,
            [
              action.orgId,
              action.policy.afterHours,
              action.policy.creditHours,
              action.travelEligibilityHours,
              userId,
            ],
          );
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported kiosk action");
      }
    });

    return Response.json(result);
  } catch (error) {
    if (isMissingKioskSchema(error)) {
      return Response.json(
        {
          error:
            "Scan-in kiosk tables are not migrated yet — run migration 0457_hours_kiosk_scan.sql, then reload.",
        },
        { status: 503 },
      );
    }
    return fail(error);
  }
}

/**
 * One scan toggles one member. Keeps the exact clock-in/clock-out semantics of
 * /api/hours: insert an open hour_logs row, or close the caller's open row with
 * closed_by set. The only addition is `occurredAt`, so an offline-queued scan is
 * written with the time it actually happened.
 */
async function scanAction(
  client: PoolClient,
  input: { action: Extract<KioskAction, { action: "scan" }>; callerId: string; role: string },
): Promise<KioskScanResult> {
  const { action, callerId, role } = input;

  const match = await client.query<{ userId: string; userName: string | null }>(
    `SELECT c.user_id AS "userId", u.name AS "userName"
     FROM member_scan_codes c
     JOIN users u ON u.id = c.user_id
     WHERE c.org_id = $1::uuid AND c.code = $2
     LIMIT 1`,
    [action.orgId, action.code],
  );
  if (!match.rowCount) {
    throw new HttpError(404, "Card not recognized — enroll it under Kiosk cards first.");
  }
  const target = match.rows[0]!;

  // A kiosk signed in as a plain member may only scan that member in and out.
  if (target.userId !== callerId && !isAdmin(role)) {
    throw new HttpError(403, "This kiosk is signed in without owner/admin access — only your own card works here.");
  }

  // Idempotency gate. A scan is a toggle, and the offline path re-sends any
  // scan whose response was lost — including ones the server already committed.
  // Claim the id first; if the claim is refused the scan is a replay, so return
  // what it did the first time rather than clocking the student straight out
  // again. Safe because withRls runs this whole handler in one transaction: the
  // claim and the toggle commit together or not at all.
  if (action.clientEventId) {
    const prior = await client.query<{
      outcome: "in" | "out";
      at: string;
      elapsedHours: number | null;
      userName: string | null;
      userId: string;
    }>(
      `SELECT e.outcome, e.occurred_at::text AS "at", e.elapsed_hours::float8 AS "elapsedHours",
              e.user_id AS "userId", u.name AS "userName"
       FROM kiosk_scan_events e
       JOIN users u ON u.id = e.user_id
       WHERE e.org_id = $1::uuid AND e.client_event_id = $2
       LIMIT 1`,
      [action.orgId, action.clientEventId],
    );
    const replay = prior.rows[0];
    if (replay) {
      return {
        outcome: replay.outcome,
        memberName: replay.userName,
        userId: replay.userId,
        at: replay.at,
        elapsedHours: replay.elapsedHours,
        backdated: action.occurredAt != null,
        duplicate: true,
      };
    }
  }

  const now = Date.now();
  const backdate = resolveOccurredAt(action.occurredAt, now);
  if (backdate.kind === "rejected") throw new HttpError(400, backdate.reason);
  const occurredAt = backdate.iso;

  const open = await client.query<{ id: string; clockIn: string }>(
    `SELECT id, clock_in::text AS "clockIn" FROM hour_logs
     WHERE org_id = $1::uuid AND user_id = $2::uuid AND clock_out IS NULL
     LIMIT 1`,
    [action.orgId, target.userId],
  );

  if (open.rowCount) {
    const closed = await client.query<{ clockOut: string; clockIn: string }>(
      `UPDATE hour_logs
       SET clock_out = GREATEST(COALESCE($3::timestamptz, now()), clock_in + interval '1 minute'),
           closed_by = $4::uuid
       WHERE id = $1::uuid AND org_id = $2::uuid AND clock_out IS NULL
       RETURNING clock_out::text AS "clockOut", clock_in::text AS "clockIn"`,
      [open.rows[0]!.id, action.orgId, occurredAt, callerId],
    );
    const record = closed.rows[0];
    if (!record) throw new HttpError(409, "That session was already closed — scan again to clock in.");
    const elapsedMs = new Date(record.clockOut).getTime() - new Date(record.clockIn).getTime();
    const elapsedHours = Number.isFinite(elapsedMs) ? ROUND2(elapsedMs / 3_600_000) : null;
    await recordScanEvent(client, {
      orgId: action.orgId,
      clientEventId: action.clientEventId,
      userId: target.userId,
      hourLogId: open.rows[0]!.id,
      outcome: "out",
      at: record.clockOut,
      elapsedHours,
      callerId,
    });
    return {
      outcome: "out",
      memberName: target.userName,
      userId: target.userId,
      at: record.clockOut,
      elapsedHours,
      backdated: backdate.kind === "backdated",
    };
  }

  const inserted = await client.query<{ id: string; clockIn: string }>(
    `INSERT INTO hour_logs (org_id, user_id, kind, note, created_by, clock_in)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, COALESCE($6::timestamptz, now()))
     RETURNING id, clock_in::text AS "clockIn"`,
    [
      action.orgId,
      target.userId,
      action.kind,
      backdate.kind === "backdated" ? "Scanned in offline; synced later." : "",
      callerId,
      occurredAt,
    ],
  );
  await recordScanEvent(client, {
    orgId: action.orgId,
    clientEventId: action.clientEventId,
    userId: target.userId,
    hourLogId: inserted.rows[0]!.id,
    outcome: "in",
    at: inserted.rows[0]!.clockIn,
    elapsedHours: null,
    callerId,
  });
  return {
    outcome: "in",
    memberName: target.userName,
    userId: target.userId,
    at: inserted.rows[0]!.clockIn,
    elapsedHours: null,
    backdated: backdate.kind === "backdated",
  };
}

/**
 * Persist the idempotency record for a scan that just toggled a member.
 *
 * The PRIMARY KEY is the real guard, not the SELECT above it: two identical
 * requests racing each other both pass the lookup, but only one can insert. The
 * loser's 23505 rolls its whole transaction back, which is the outcome we want
 * — one toggle, one hour_logs row, no double-count.
 */
async function recordScanEvent(
  client: PoolClient,
  input: {
    orgId: string;
    clientEventId: string | null;
    userId: string;
    hourLogId: string;
    outcome: "in" | "out";
    at: string;
    elapsedHours: number | null;
    callerId: string;
  },
): Promise<void> {
  if (!input.clientEventId) return;
  await client.query(
    `INSERT INTO kiosk_scan_events
       (org_id, client_event_id, user_id, hour_log_id, outcome, occurred_at, elapsed_hours, recorded_by)
     VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::timestamptz, $7, $8::uuid)`,
    [
      input.orgId,
      input.clientEventId,
      input.userId,
      input.hourLogId,
      input.outcome,
      input.at,
      input.elapsedHours,
      input.callerId,
    ],
  );
}

/**
 * Forgot-to-sign-out sweep. The decision of what to close and how much to credit
 * lives entirely in the pure planAutoClose(); this only reads the open rows and
 * writes the plan back, flagged for mentor review.
 */
async function sweepAction(client: PoolClient, input: { orgId: string; callerId: string }) {
  const [policyRows, openRows] = await Promise.all([
    client.query<{ afterHours: number; creditHours: number }>(
      `SELECT auto_close_after_hours::float8 AS "afterHours",
              auto_close_credit_hours::float8 AS "creditHours"
       FROM hour_policies WHERE org_id = $1::uuid`,
      [input.orgId],
    ),
    client.query<OpenSession>(
      `SELECT l.id, l.user_id AS "userId", u.name AS "userName", l.clock_in::text AS "clockIn"
       FROM hour_logs l
       JOIN users u ON u.id = l.user_id
       WHERE l.org_id = $1::uuid AND l.clock_out IS NULL`,
      [input.orgId],
    ),
  ]);

  const plan = planAutoClose({
    sessions: openRows.rows,
    policy: normalizeAutoClosePolicy({
      afterHours: policyRows.rows[0]?.afterHours ?? null,
      creditHours: policyRows.rows[0]?.creditHours ?? null,
    }),
    now: Date.now(),
  });

  let applied = 0;
  for (const closure of plan.closures) {
    const updated = await client.query(
      `UPDATE hour_logs
       SET clock_out = GREATEST($3::timestamptz, clock_in + interval '1 minute'),
           closed_by = $4::uuid,
           auto_closed = true,
           auto_closed_reason = $5
       WHERE id = $1::uuid AND org_id = $2::uuid AND clock_out IS NULL`,
      [closure.id, input.orgId, closure.clockOut, input.callerId, closure.reason],
    );
    applied += updated.rowCount ?? 0;
  }

  return {
    applied,
    keptOpen: plan.keptOpen,
    policy: plan.policy,
    summary: describeAutoClosePlan(plan),
    closures: plan.closures,
  };
}
