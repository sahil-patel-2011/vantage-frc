import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  applyWatchAction,
  computeDutiesView,
  isWatchActionName,
  parseWatchAction,
  type DutiesView,
} from "../../../lib/duties";
import {
  computeDutyRosterView,
  createDuty,
  deleteDuty,
  parseDutyAction,
  updateDuty,
} from "../../../lib/duty-roster";

export type { DutiesView };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Duty roster request failed";
  if (/duty_assignments|relation .* does not exist|0500_duty_on_duty_chaperone|0145_duty_roster/i.test(message)) {
    return Response.json(
      { error: message.includes("0500") ? message : "Apply the duty roster migration first (0145_duty_roster)." },
      { status: 503 },
    );
  }
  if (/Only an owner or admin/i.test(message)) {
    return Response.json({ error: message }, { status: 403 });
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const requestedOrg = new URL(request.url).searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeDutiesView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const userId = session.user.id;
    const watchNamed =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { action?: unknown }).action
        : null;

    if (isWatchActionName(watchNamed)) {
      const action = parseWatchAction(body);
      const view = await withRls({ userId, orgId: action.orgId }, async (client) => {
        await applyWatchAction(client, { ...action, userId });
        return computeDutiesView(client, { userId, requestedOrg: action.orgId });
      });
      return Response.json(view);
    }

    const action = parseDutyAction(body);
    const view = await withRls({ userId, orgId: action.orgId }, async (client) => {
      switch (action.action) {
        case "create_duty":
          await createDuty(client, { ...action, userId });
          break;
        case "update_duty":
          await updateDuty(client, { ...action, userId });
          break;
        case "delete_duty":
          await deleteDuty(client, { orgId: action.orgId, id: action.id, userId });
          break;
        default:
          throw new HttpError(400, "Unsupported duty action");
      }
      return computeDutyRosterView(client, { userId, requestedOrg: action.orgId });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
