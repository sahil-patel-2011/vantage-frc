import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  loadRoleOnboarding,
  refreshRoleOnboarding,
  setCheckCompleted,
  setTrackDismissed,
} from "../../../lib/role-onboarding";

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
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Role onboarding request failed" },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadRoleOnboarding(client, { userId: session.user.id, orgId }),
    );
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type Body = {
  action?: string;
  orgId?: string;
  trackKey?: string;
  checkKey?: string;
  done?: boolean;
  dismissed?: boolean;
};

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Body;
    const orgId = body.orgId?.trim();
    if (!orgId) throw new HttpError(400, "orgId is required");

    const action = body.action ?? "";
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      if (action === "refresh") {
        return refreshRoleOnboarding(client, { userId: session.user.id, orgId });
      }
      if (action === "check" || action === "uncheck") {
        if (!body.trackKey || !body.checkKey) {
          throw new HttpError(400, "trackKey and checkKey are required");
        }
        return setCheckCompleted(client, {
          userId: session.user.id,
          orgId,
          trackKey: body.trackKey,
          checkKey: body.checkKey,
          done: action === "check",
        });
      }
      if (action === "dismiss" || action === "undismiss") {
        if (!body.trackKey) throw new HttpError(400, "trackKey is required");
        return setTrackDismissed(client, {
          userId: session.user.id,
          orgId,
          trackKey: body.trackKey,
          dismissed: action === "dismiss",
        });
      }
      throw new HttpError(400, "Unknown action");
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
