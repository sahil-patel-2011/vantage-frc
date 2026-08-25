/**
 * Fallback download path for the in-place "Export CSV" button.
 *
 * The normal path never touches the network: the button serialises the rows already
 * rendered on the page and hands them to the browser as a Blob. A few environments
 * cannot take a Blob download (the Electron shell's stricter window, browsers with
 * anchor `download` disabled), so those POST the finished CSV here and the browser's
 * own download machinery takes it from the Content-Disposition header.
 *
 * Deliberately has NO database access. Every byte it returns came from the caller's
 * own already-authorised page render, so there is no new read path and nothing for
 * RLS to widen. It still requires a live session, so an unauthenticated request
 * cannot use the app as an open file-echo service.
 */

import { auth } from "@vantage/core";
import { headers } from "next/headers";
import {
  EXPORT_TABLE_MAX_BYTES,
  csvContentDisposition,
  sanitizeCsvFileName,
} from "../../../../lib/export/attachment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function readPayload(request: Request): Promise<{ fileName: unknown; csv: unknown }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown> | null;
    return { fileName: body?.fileName, csv: body?.csv };
  }
  const form = await request.formData();
  return { fileName: form.get("fileName"), csv: form.get("csv") };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return fail("Authentication required", 401);

  let payload: { fileName: unknown; csv: unknown };
  try {
    payload = await readPayload(request);
  } catch {
    return fail("Could not read the export payload", 400);
  }

  const csv = payload.csv;
  if (typeof csv !== "string" || csv.length === 0) return fail("csv is required", 400);

  const bytes = Buffer.byteLength(csv, "utf8");
  if (bytes > EXPORT_TABLE_MAX_BYTES) {
    return fail("This table is too large for an in-place export — use Export Center at /exports.", 413);
  }

  const fileName = sanitizeCsvFileName(payload.fileName);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": csvContentDisposition(fileName),
      "content-length": String(bytes),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
