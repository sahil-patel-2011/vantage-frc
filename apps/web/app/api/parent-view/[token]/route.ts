import { requestPool } from "@vantage/db";
import { PARENT_TOKEN_PATTERN } from "../../../../lib/parent-comms/tokens";
import {
  classifyParentView,
  type ParentViewPayload,
  type ParentViewState,
} from "../../../../lib/parent-comms/view";

/**
 * Public, unauthenticated parent view resolver. Authorized solely by the
 * opaque per-contact view token in the path (allow-listed by narrow regex in
 * proxy.ts). get_parent_view (migration 0471, SECURITY DEFINER) returns ONLY
 * org name/team number, upcoming events (title/start/end/location), and the
 * linked student's OWN RSVP — NULL for unknown or deactivated tokens, so there
 * is no unauthenticated dump and no cross-org leak. No student contact info
 * and no other student's name ever appear in this payload.
 */
export const dynamic = "force-dynamic";

function notFound(): Response {
  return Response.json(
    { error: "This link is not valid or has been turned off by the team." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!PARENT_TOKEN_PATTERN.test(token)) return notFound();

  let payload: ParentViewPayload | null | "unavailable";
  try {
    const result = await requestPool.query<{ view: ParentViewPayload | null }>(
      "SELECT get_parent_view($1) AS view",
      [token],
    );
    payload = result.rows[0]?.view ?? null;
  } catch {
    // Database unreachable: we cannot tell a bad token from an outage, so the
    // parent sees an honest "try again later" — never invented data.
    payload = "unavailable";
  }

  if (payload === null) return notFound();

  const state: ParentViewState = classifyParentView(payload);
  return Response.json(state, {
    status: 200,
    // The URL is a capability token — keep it off shared caches.
    headers: { "cache-control": "private, no-store" },
  });
}
