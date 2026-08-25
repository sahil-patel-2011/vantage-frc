import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { describeUserAgent, parseSubscriptionInput } from "../../../lib/push/subscription";
import { pushSetupStatus } from "../../../lib/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Device registry for Web Push. One row per browser (endpoint is globally unique),
 * owned by the person — RLS lets a member see and manage only their own devices,
 * never a teammate's (migration 0463).
 *
 * Everything here degrades honestly: with no VAPID keys the GET says `setup_required`
 * and the POST refuses, because a stored subscription we can never sign for would be a
 * silent promise that a phone will buzz when it never will. In-app notifications are
 * unaffected either way.
 */

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

type DeviceRow = {
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  failedAt: string | null;
};

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const status = pushSetupStatus();
  try {
    const devices = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<DeviceRow>(
        `SELECT endpoint, user_agent AS "userAgent", created_at AS "createdAt",
                last_seen_at AS "lastSeenAt", failed_at AS "failedAt"
           FROM push_subscriptions
          WHERE user_id = $1::uuid
          ORDER BY last_seen_at DESC`,
        [session.user.id],
      );
      return result.rows;
    });

    return Response.json({
      state: status.state,
      ...(status.state === "ready" ? { publicKey: status.publicKey } : { detail: status.detail, missing: status.missing }),
      subscribed: devices.length > 0,
      devices: devices.map((device) => ({
        endpoint: device.endpoint,
        label: describeUserAgent(device.userAgent),
        lastSeenAt: device.lastSeenAt,
        failing: device.failedAt != null,
      })),
    });
  } catch {
    // No database yet (or the migration has not run): report setup, never a fake "on".
    return Response.json({
      state: "setup_required",
      detail:
        status.state === "ready"
          ? "Could not read your registered devices. Run the 0463 migration and try again."
          : status.detail,
      subscribed: false,
      devices: [],
    });
  }
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const status = pushSetupStatus();
  if (status.state !== "ready") {
    return Response.json({ error: status.detail, missing: status.missing }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseSubscriptionInput(body, request.headers.get("user-agent"));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  try {
    const saved = await withRls({ userId: session.user.id }, async (client) => {
      // org_id is a hint about which workspace the device was registered from; it is
      // never an authorization boundary, but storing an org the user is not in would
      // still be wrong, so drop it unless the membership is real.
      let orgId: string | null = null;
      if (input.orgId) {
        const membership = await client.query(
          `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
          [input.orgId, session.user.id],
        );
        orgId = membership.rowCount ? input.orgId : null;
      }

      // `pushsubscriptionchange` in the service worker re-registers a rotated endpoint
      // and tells us which one it replaced; drop the stale row so the member does not
      // accumulate dead devices in their list.
      const previous = (body as { previousEndpoint?: unknown }).previousEndpoint;
      if (typeof previous === "string" && previous.trim() && previous.trim() !== input.endpoint) {
        await client.query(
          `DELETE FROM push_subscriptions WHERE user_id = $1::uuid AND endpoint = $2::text`,
          [session.user.id, previous.trim()],
        );
      }

      const result = await client.query<{ endpoint: string }>(
        `INSERT INTO push_subscriptions (user_id, org_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text)
         ON CONFLICT (endpoint) DO UPDATE
            SET p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                org_id = EXCLUDED.org_id,
                user_agent = EXCLUDED.user_agent,
                last_seen_at = now(),
                failed_at = NULL
         RETURNING endpoint`,
        [session.user.id, orgId, input.endpoint, input.p256dh, input.auth, input.userAgent],
      );
      return result.rows[0]?.endpoint ?? input.endpoint;
    });

    return Response.json({ ok: true, endpoint: saved, label: describeUserAgent(input.userAgent) });
  } catch (error) {
    // RLS blocks re-pointing an endpoint that belongs to a different account — that is
    // the correct answer for a shared browser, so say what it means.
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") {
      return Response.json(
        {
          error:
            "This browser is already registered to another Vantage account. Turn notifications off in that account first.",
        },
        { status: 409 },
      );
    }
    return Response.json({ error: "Could not save this device." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let endpoint: string | null = null;
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : null;
  } catch {
    endpoint = null;
  }

  try {
    const removed = await withRls({ userId: session.user.id }, async (client) => {
      // No endpoint given: the member is turning push off everywhere.
      const result = endpoint
        ? await client.query(
            `DELETE FROM push_subscriptions WHERE user_id = $1::uuid AND endpoint = $2::text`,
            [session.user.id, endpoint],
          )
        : await client.query(`DELETE FROM push_subscriptions WHERE user_id = $1::uuid`, [
            session.user.id,
          ]);
      return result.rowCount ?? 0;
    });
    return Response.json({ ok: true, removed });
  } catch {
    return Response.json({ error: "Could not remove this device." }, { status: 500 });
  }
}
