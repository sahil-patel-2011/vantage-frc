import { requestPool, withRls } from "@vantage/db";
import {
  classifyExitInvite,
  hashExitInviteToken,
  isExitInviteToken,
  parseExitInviteResponse,
  type ExitInviteState,
  type ResolvedExitInvite,
} from "../../../../lib/exit-interview/invites";
import { submitExitInviteResponse } from "../../../../lib/exit-interview/compute-exit-interview";

/**
 * Public, unauthenticated self-serve exit interview (allow-listed in proxy.ts
 * next to the parent-view token routes). Authorized solely by the opaque
 * one-time token in the link. Reads go through get_exit_interview_invite
 * (migration 0501, SECURITY DEFINER, token hash in, NULL for unknown) exactly
 * like the parent view; the write runs inside withRls scoped as the invite's
 * creator (an owner/admin of that org) so it lands through the same
 * logExitInterview path the mentor form uses — RLS still applies, no admin
 * pool is involved.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;

function notFound(): Response {
  return Response.json(
    { error: "This link is not valid or has been turned off by the team." },
    { status: 404, headers: NO_STORE },
  );
}

async function resolveInvite(token: string): Promise<ResolvedExitInvite | null | "unavailable"> {
  try {
    const result = await requestPool.query<{ invite: ResolvedExitInvite | null }>(
      "SELECT get_exit_interview_invite($1) AS invite",
      [hashExitInviteToken(token)],
    );
    return result.rows[0]?.invite ?? null;
  } catch {
    // Database unreachable: cannot tell a bad link from an outage — say so.
    return "unavailable";
  }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!isExitInviteToken(token)) return notFound();

  const invite = await resolveInvite(token);
  if (invite === "unavailable") {
    return Response.json({ error: "The team's database is unavailable right now. Try again later." }, { status: 503, headers: NO_STORE });
  }
  const state: ExitInviteState = classifyExitInvite(invite);
  if (state.status === "invalid") return notFound();
  return Response.json(state, { status: 200, headers: NO_STORE });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const token = body.token;
  if (!isExitInviteToken(token)) return notFound();

  const invite = await resolveInvite(token);
  if (invite === "unavailable") {
    return Response.json({ error: "The team's database is unavailable right now. Try again later." }, { status: 503, headers: NO_STORE });
  }
  const state = classifyExitInvite(invite);
  if (state.status === "invalid" || !invite) return notFound();
  if (state.status === "used") {
    return Response.json({ error: "This link has already been used." }, { status: 410, headers: NO_STORE });
  }
  if (state.status === "expired") {
    return Response.json({ error: "This link has expired. Ask a mentor for a fresh one." }, { status: 410, headers: NO_STORE });
  }

  const parsed = parseExitInviteResponse(body, invite);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: NO_STORE });

  try {
    await withRls({ userId: invite.createdBy, orgId: invite.orgId }, (client) =>
      submitExitInviteResponse(client, { invite, response: parsed.value }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "used") {
      return Response.json({ error: "This link has already been used." }, { status: 410, headers: NO_STORE });
    }
    // The creator lost owner/admin access or the org changed: the link no longer works.
    return Response.json(
      { error: "This link can no longer be used. Ask a mentor for a fresh one." },
      { status: 409, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true, orgName: invite.orgName }, { status: 200, headers: NO_STORE });
}
