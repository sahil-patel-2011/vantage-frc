import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { requestHasAnalyticsConsent } from "../../../../lib/product-analytics/consent";
import { MAX_BATCH_EVENTS, validateBatch } from "../../../../lib/product-analytics/events";

export const runtime = "nodejs";

/**
 * POST /api/analytics/events — the only way a product event is ever stored.
 *
 * Three gates, in this order, and all three are server-side:
 *
 *   1. A real session. Events are attributed to an account, so there is no
 *      unauthenticated path in. A signed-out visitor cannot write here at all.
 *   2. A granted consent cookie at the CURRENT consent version. The browser
 *      tracker already checks this, but the check that matters is this one —
 *      anyone can POST, and a client that ignores the answer is refused.
 *   3. Membership in the org the events are attributed to, enforced by the
 *      insert's own RLS policy as well as by the lookup below.
 *
 * Unknown event names are rejected rather than stored as-is, so the vocabulary
 * cannot be widened from the client. The whole batch is not discarded for one
 * bad row; the rejected count is returned instead.
 *
 * Nothing here is on a user's critical path: `sendBeacon` ignores the response,
 * and a failure returns an honest error rather than a fake success.
 */

/** Bytes. A batch of 40 small events is far under this; anything larger is junk. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const requestHeaders = await headers();

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: requestHeaders });
  } catch {
    return Response.json({ error: "Authentication unavailable" }, { status: 503 });
  }
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  // Consent is checked from the request's own cookies. No consent, no row —
  // and we say so plainly rather than returning a hollow 200.
  if (!requestHasAnalyticsConsent(requestHeaders)) {
    return Response.json({ error: "Analytics consent not granted", accepted: 0 }, { status: 403 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = validateBatch(payload);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, maxBatch: MAX_BATCH_EVENTS }, { status: 400 });
  }
  const { events, rejected } = parsed.value;

  try {
    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string }>(
        `SELECT m.org_id AS "orgId"
           FROM memberships m
           JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = $1::uuid
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
          LIMIT 1`,
        [session.user.id],
      );
      const orgId = membership.rows[0]?.orgId;
      // A signed-in account with no team yet has nowhere org-scoped to write.
      // That is a real state, not an error, and it stores nothing.
      if (!orgId) return { accepted: 0, stored: false as const, reason: "no_membership" as const };

      await client.query(
        `INSERT INTO product_events (org_id, user_id, event, path, device_class, meta)
         SELECT $1::uuid, $2::uuid, e.event, e.path, e.device_class, e.meta
           FROM jsonb_to_recordset($3::jsonb)
             AS e(event text, path text, device_class text, meta jsonb)`,
        [
          orgId,
          session.user.id,
          JSON.stringify(
            events.map((event) => ({
              event: event.event,
              path: event.path,
              device_class: event.deviceClass,
              meta: event.meta,
            })),
          ),
        ],
      );

      return { accepted: events.length, stored: true as const };
    });

    return Response.json({ ...result, rejected }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analytics write failed";
    // Missing table / unconfigured database degrades to a clear setup state
    // instead of a crash, in line with the rest of the product.
    if (/product_events|does not exist|DATABASE_/i.test(message)) {
      return Response.json({ error: "Analytics storage is not configured", accepted: 0 }, { status: 503 });
    }
    return Response.json({ error: message, accepted: 0 }, { status: 500 });
  }
}
