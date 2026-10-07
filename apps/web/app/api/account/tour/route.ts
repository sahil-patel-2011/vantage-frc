import { claimFirstTour } from "@vantage/core/first-run-tour";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

/** Claim once before rendering. Concurrent tabs/devices cannot both start it. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    await parseSecureJson(request, z.object({}).strict());
    const start = await withRls({ userId: session.user.id }, client => claimFirstTour(client, session.user.id));
    return Response.json({ start }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return securityErrorResponse(error, "Could not record the first-run tour."); }
}
