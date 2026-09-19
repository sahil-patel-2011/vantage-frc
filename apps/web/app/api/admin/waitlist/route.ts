import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  platformAdminDeniedResponse,
  publicSignupStatus,
  writeAdminAction,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import { createWaitlistStore, waitlistBackend } from "../../../../lib/marketing/waitlist";
import { waitlistUnavailableMessage } from "../../../../lib/marketing/waitlist-copy";

async function runAdmin<T>(
  work: (ctx: { client: PoolClient; session: { user: { id: string } } }) => Promise<T>,
  requireMfa = false,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    if (requireMfa) {
      await assertPlatformPrivilegeMfa(client, { userId: session.user.id, sessionId: session.session.id });
    }
    return work({ client, session });
  });
}

export async function GET(request: Request) {
  try {
    /**
     * Whether the doors are open ships with the list of people waiting at
     * them. `publicSignupStatus` has existed and been tested since the switch
     * was built, and nothing rendered it — so the only way to know what state
     * sign-up was in, or which of the two conditions was still holding it
     * closed, was to read the source and then go and read Vercel's
     * environment variables. It is one line of JSON; it belongs here.
     *
     * Read on the server on purpose: `VANTAGE_PUBLIC_SIGNUP` is deployment
     * configuration and is never shipped to a browser.
     */
    const signup = publicSignupStatus();
    if (waitlistBackend() === "unavailable") {
      return Response.json(
        { error: waitlistUnavailableMessage(), status: "setup_required", signup },
        { status: 503 },
      );
    }
    const q = new URL(request.url).searchParams.get("q") ?? undefined;
    const entries = await runAdmin(async () => createWaitlistStore().list({ q }));
    return Response.json({ entries, signup });
  } catch (error) {
    // Whether the doors are open does not depend on the waitlist store being
    // reachable. A misconfigured MARKETING_DATABASE_URL used to take the
    // sign-up status down with the list, which is the one moment an operator
    // most needs to see it.
    const denied = platformAdminDeniedResponse(error);
    if (denied.status === 404) return denied;
    const body = (await denied.json()) as Record<string, unknown>;
    return Response.json({ ...body, signup: publicSignupStatus() }, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string; email?: string };
    const action = body.action;
    const email = body.email?.trim().toLowerCase();
    if (!email || (action !== "mark_invited" && action !== "mark_converted")) {
      return Response.json({ error: "action and email are required" }, { status: 400 });
    }
    if (waitlistBackend() === "unavailable") {
      return Response.json(
        { error: waitlistUnavailableMessage(), status: "setup_required" },
        { status: 503 },
      );
    }

    const entry = await runAdmin(async ({ client, session }) => {
      const store = createWaitlistStore();
      const updated =
        action === "mark_invited" ? await store.markLaunchInvited(email) : await store.markConverted(email);
      if (!updated) throw new Error("Waitlist entry not found");
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: action === "mark_invited" ? "waitlist.launch_invited" : "waitlist.converted",
        payload: { email, teamNumber: updated.teamNumber },
      });
      return updated;
    }, true);

    return Response.json({ entry });
  } catch (error) {
    if (error instanceof Error && /waitlist entry not found/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return platformAdminDeniedResponse(error);
  }
}
