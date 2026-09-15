import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { headers } from "next/headers";
import {
  csvContentDisposition,
  sanitizeCsvFileName,
} from "../../../../lib/export/attachment";
import { csvFileName } from "../../../../lib/export/to-csv";
import { eventAnswersCsv } from "../../../../lib/scouting/event-answers-csv";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

function csvResponse(csv: string, fileName: string) {
  const safeName = sanitizeCsvFileName(fileName);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": csvContentDisposition(safeName),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const data = await withScoutingRequest(orgId, (client) =>
      new ScoutingRepository(client).listEventAnswers(orgId!),
    );
    const wantsCsv =
      url.searchParams.get("format") === "csv" || url.searchParams.get("download") === "1";
    if (wantsCsv) {
      return csvResponse(eventAnswersCsv(data), csvFileName("scouting-answers", data.eventKey));
    }
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
