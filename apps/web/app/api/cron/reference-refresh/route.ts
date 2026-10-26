import { buildClaimedDossier } from "../../../../lib/team-dossier/refresh";
import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import {
  runEventDirectory,
  runOnDemandEventRefresh,
  runTbaEventDaySync,
  runTbaSeasonSync,
  runTeamYearHistorySync,
} from "../../../../lib/reference/worker-ingest";
import { publicErrorMessage } from "../../../../lib/security/public-error";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Worker entry for reference refreshes a signed-in route is not allowed to run
 * itself. The caller is CRON_SECRET. The signed-in route checks the person's
 * role, then posts here.
 */
type RefreshJob =
  | { kind: "event-day"; year?: number; eventKeys?: string[]; preferOrgIds?: string[] }
  | { kind: "season"; year?: number; preferOrgIds?: string[] }
  | { kind: "history"; year?: number }
  | { kind: "event-directory"; year: number; preferOrgIds?: string[] }
  | { kind: "team-dossier"; orgId: string; teamNumber: number }
  | { kind: "on-demand-event"; eventKey: string; preferOrgIds?: string[]; windowMs?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isJob(value: unknown): value is RefreshJob {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const job = value as { kind?: unknown };
  return (
    job.kind === "event-day" ||
    job.kind === "season" ||
    job.kind === "history" ||
    job.kind === "event-directory" ||
    job.kind === "team-dossier" ||
    job.kind === "on-demand-event"
  );
}

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isJob(body)) return Response.json({ error: "Unknown refresh" }, { status: 400 });
  try {
    switch (body.kind) {
      case "event-day":
        return Response.json({
          summary: await runTbaEventDaySync(
            { year: body.year, eventKeys: body.eventKeys },
            { preferOrgIds: body.preferOrgIds },
          ),
        });
      case "season":
        return Response.json({
          summary: await runTbaSeasonSync(body.year, { preferOrgIds: body.preferOrgIds }),
        });
      case "history":
        return Response.json({ history: await runTeamYearHistorySync(body.year) });
      case "event-directory":
        return Response.json({
          count: await runEventDirectory(body.year, { preferOrgIds: body.preferOrgIds }),
        });
      case "team-dossier":
        if (!UUID.test(body.orgId) || !Number.isInteger(body.teamNumber)) {
          return Response.json({ error: "orgId and teamNumber are required" }, { status: 400 });
        }
        return Response.json({ status: await buildClaimedDossier(body.orgId, body.teamNumber) });
      case "on-demand-event":
        return Response.json({
          status: await runOnDemandEventRefresh(body.eventKey, {
            preferOrgIds: body.preferOrgIds,
            windowMs: body.windowMs,
          }),
        });
      default: {
        const unreachable: never = body;
        return unreachable;
      }
    }
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "Reference refresh failed") },
      { status: 500 },
    );
  }
}
