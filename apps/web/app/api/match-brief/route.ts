// The pre-match strategy brief (lib/match-brief): one per team per match, shared by everyone on
// the team. GET reads it, and with ?mode=ensure writes a fresh one when it is out of date and the
// person has automatic briefs on; POST {action:"regenerate"} writes a new one on demand.
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadCockpitPrefs } from "../../../lib/cockpit/load-prefs";
import { getOrWriteMatchBrief } from "../../../lib/match-brief/generate";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

/** A model writing a brief takes a few seconds to a minute (longer on a local model). */
// "Predict this match" on Home says up to five minutes; the plan write gets all of it.
export const maxDuration = 300;

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

function fail(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  return failMeteredAi(error, "The match brief couldn't be written right now.");
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const matchKey = url.searchParams.get("matchKey");
    const wantsEnsure = url.searchParams.get("mode") === "ensure";
    const result = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      const prefs = wantsEnsure ? await loadCockpitPrefs(client, session.user.id) : null;
      return getOrWriteMatchBrief(client, {
        userId: session.user.id,
        userName: session.user.name ?? null,
        orgId,
        matchKey,
        mode: wantsEnsure && prefs?.autoMatchBriefs ? "ensure" : "read",
      });
    });
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json().catch(() => null)) as { orgId?: unknown; matchKey?: unknown; action?: unknown } | null;
    if (!body || body.action !== "regenerate") throw new HttpError(400, "Unknown action");
    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    const matchKey = typeof body.matchKey === "string" ? body.matchKey : null;
    const result = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, (client) =>
      getOrWriteMatchBrief(client, {
        userId: session.user.id,
        userName: session.user.name ?? null,
        orgId,
        matchKey,
        mode: "regenerate",
      }),
    );
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
