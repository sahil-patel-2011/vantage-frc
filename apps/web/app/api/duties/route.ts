import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeDutyRosterView,
  createDuty,
  deleteDuty,
  parseDutyAction,
  updateDuty,
  type DutyRosterView,
} from "../../../lib/duty-roster";

export type { DutyRosterView };

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
  if (/duty_assignments|relation .* does not exist/i.test(message)) {
    return Response.json(
      { error: "Apply the duty roster migration first (0145_duty_roster)." },
      { status: 503 },
    );
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
      computeDutyRosterView(client, { userId: session.user.id, requestedOrg }),
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

    const action = parseDutyAction(body);
    const userId = session.user.id;

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
