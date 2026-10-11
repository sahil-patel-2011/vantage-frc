import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import { sessionViews, type SessionRow } from "../../../../lib/account/sessions";
import { RequestSecurityError, parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";
import { SIGNED_OUT_MESSAGE } from "../../../../lib/security/signed-out";

/**
 * Where this person is signed in, and ending the other sessions (QA A1-10).
 *
 * Read through Better Auth's own adapter on the server: its `/list-sessions` endpoint refuses a
 * session older than a day ("fresh" only), which is most sessions, and it returns the session
 * tokens, which must not reach the page. Only `sessionViews` output leaves this route. Ending a
 * session goes through `revokeSession` / `revokeOtherSessions`, which check it is this person's.
 */

const noStore = { "Cache-Control": "private, no-store" };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke-others") }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(200) }).strict(),
]);

async function current() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  return session ? { session, requestHeaders } : null;
}

async function ownSessions(userId: string): Promise<Array<SessionRow & { token: string; userId: string }>> {
  const context = await auth.$context;
  const rows = (await context.internalAdapter.listSessions(userId)) as Array<SessionRow & { token: string; userId: string }>;
  return rows.filter((row) => row.userId === userId);
}

export async function GET() {
  const me = await current();
  if (!me) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401, headers: noStore });
  try {
    const rows = await ownSessions(me.session.user.id);
    return Response.json({ sessions: sessionViews(rows, me.session.session.id, Date.now()) }, { headers: noStore });
  } catch (error) {
    console.error("[account-sessions]", error instanceof Error ? error.name : typeof error);
    return Response.json({ error: "Couldn't load where you're signed in. Try again in a minute." }, { status: 500, headers: noStore });
  }
}

export async function POST(request: Request) {
  const me = await current();
  if (!me) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401, headers: noStore });
  try {
    const body = await parseSecureJson(request, schema);
    if (body.action === "revoke-others") {
      await auth.api.revokeOtherSessions({ headers: me.requestHeaders });
    } else {
      if (body.id === me.session.session.id) {
        return Response.json({ error: "To end this session, use Sign out." }, { status: 400, headers: noStore });
      }
      const row = (await ownSessions(me.session.user.id)).find((session) => session.id === body.id);
      // Already ended (or never this person's): the list just needs a refresh.
      if (row) await auth.api.revokeSession({ body: { token: row.token }, headers: me.requestHeaders });
    }
    const rows = await ownSessions(me.session.user.id);
    return Response.json({ sessions: sessionViews(rows, me.session.session.id, Date.now()) }, { headers: noStore });
  } catch (error) {
    // A malformed or cross-site request says why; anything else is ours, said plainly.
    if (error instanceof RequestSecurityError || error instanceof z.ZodError) {
      return securityErrorResponse(error, "Couldn't sign out that session.");
    }
    console.error("[account-sessions]", error instanceof Error ? error.name : typeof error);
    return Response.json({ error: "Couldn't sign out that session. Try again in a minute." }, { status: 500, headers: noStore });
  }
}
