import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { getRunPdf, resolveMembership } from "../../../../../lib/assembly-manual/store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ._-]/g, "").trim() || "assembly";
  return `${cleaned.slice(0, 80)} assembly manual.pdf`;
}

/**
 * Download the printed manual.
 *
 * A miss is a 404 whether the run belongs to another team, does not exist, or
 * has not finished — so a run id cannot be probed. The response is sandboxed
 * and no-store: this is a team's CAD, and it should not sit in a shared cache.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response(null, { status: 404 });
  const { runId } = await params;
  if (!UUID.test(runId)) return new Response(null, { status: 404 });

  try {
    const found = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      return getRunPdf(client, membership.orgId, runId);
    });
    if (!found) return new Response(null, { status: 404 });

    const body = new ArrayBuffer(found.pdf.byteLength);
    new Uint8Array(body).set(found.pdf);
    return new Response(body, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(found.pdf.byteLength),
        "content-disposition": `attachment; filename="${safeFilename(found.assemblyName)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
