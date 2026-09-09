import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { getStepRender, resolveMembership } from "../../../../../../lib/assembly-manual/store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One step's picture.
 *
 * Served separately from the step list so the viewer can page through a
 * 200-step manual without pulling every render. A step with no render 404s and
 * the viewer shows its labelled placeholder — there is no substitute image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; stepNumber: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response(null, { status: 404 });
  const { runId, stepNumber } = await params;
  const step = Number(stepNumber);
  if (!UUID.test(runId) || !Number.isInteger(step) || step < 1) return new Response(null, { status: 404 });

  try {
    const png = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      return getStepRender(client, membership.orgId, runId, step);
    });
    if (!png) return new Response(null, { status: 404 });

    const body = new ArrayBuffer(png.byteLength);
    new Uint8Array(body).set(png);
    return new Response(body, {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
