import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMeetingAutopilotView,
  currentSeasonYear,
  deleteActionItem,
  deleteAgenda,
  draftMinutesActionItems,
  generateAgenda,
  saveMinutes,
  updateActionItemStatus,
  updateAgendaStatus,
  type MeetingAutopilotView,
} from "../../../lib/meeting-autopilot/compute-meeting-autopilot";
import { requireCalendarEventId } from "../../../lib/meeting-autopilot/persist";
import type { ActionItemStatus, MeetingAgendaStatus } from "../../../lib/meeting-autopilot/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { MeetingAutopilotView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMeetingAutopilotView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the meeting-agenda autopilot. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MeetingAutopilotView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "generate-agenda": {
          const calendarEventId = requireCalendarEventId(body.calendarEventId);
          await generateAgenda(client, { orgId, userId, seasonYear, calendarEventId });
          break;
        }
        case "save-minutes": {
          const minutesText = trimmedOrNull(body.minutesText, 20_000);
          if (!minutesText) throw new Error("minutesText is required");
          await saveMinutes(client, {
            orgId,
            userId,
            seasonYear,
            calendarEventId: trimmedOrNull(body.calendarEventId, 64),
            agendaId: trimmedOrNull(body.agendaId, 64),
            minutesText,
          });
          break;
        }
        case "draft-minutes": {
          const minutesText = trimmedOrNull(body.minutesText, 20_000);
          if (!minutesText) throw new Error("minutesText is required");
          const saved = await saveMinutes(client, {
            orgId,
            userId,
            seasonYear,
            calendarEventId: trimmedOrNull(body.calendarEventId, 64),
            agendaId: trimmedOrNull(body.agendaId, 64),
            minutesText,
          });
          await draftMinutesActionItems(client, { orgId, userId, agendaId: saved.agendaId, minutesText });
          break;
        }
        case "update-action-item": {
          const actionItemId = trimmedOrNull(body.actionItemId, 64);
          const status = oneOf<ActionItemStatus>(["open", "done"], body.status);
          if (!actionItemId) throw new Error("actionItemId is required");
          if (!status) throw new Error("status is required");
          await updateActionItemStatus(client, { orgId, actionItemId, status });
          break;
        }
        case "update-agenda-status": {
          const agendaId = trimmedOrNull(body.agendaId, 64);
          const status = oneOf<MeetingAgendaStatus>(["draft", "finalized"], body.status);
          if (!agendaId) throw new Error("agendaId is required");
          if (!status) throw new Error("status is required");
          await updateAgendaStatus(client, { orgId, agendaId, status });
          break;
        }
        case "delete-agenda": {
          const agendaId = trimmedOrNull(body.agendaId, 64);
          if (!agendaId) throw new Error("agendaId is required");
          await deleteAgenda(client, { orgId, agendaId });
          break;
        }
        case "delete-action-item": {
          const actionItemId = trimmedOrNull(body.actionItemId, 64);
          if (!actionItemId) throw new Error("actionItemId is required");
          await deleteActionItem(client, { orgId, actionItemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMeetingAutopilotView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Meeting agenda request failed");
  }
}
