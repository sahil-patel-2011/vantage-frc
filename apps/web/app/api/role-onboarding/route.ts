import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../lib/security/request";
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

const mutationLimiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, namespace: "role-onboarding" });
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh"), orgId: z.string().uuid() }).strict(),
  z.object({ action: z.enum(["check", "uncheck"]), orgId: z.string().uuid(), trackKey: z.string().min(1).max(80), checkKey: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.enum(["dismiss", "undismiss"]), orgId: z.string().uuid(), trackKey: z.string().min(1).max(80) }).strict(),
]);

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  if (!(error instanceof HttpError)) return securityErrorResponse(error, "Role onboarding request failed");
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Role onboarding request failed" },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadRoleOnboarding(client, { userId: session.user.id, orgId }),
    );
    return privateJson(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!(await mutationLimiter.allow(`${session.user.id}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many checklist changes. Wait a moment and try again.");
    }
    const body = await parseSecureJson(request, bodySchema);
    const orgId = body.orgId;

    const action = body.action;
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

    return privateJson(view);
  } catch (error) {
    return fail(error);
  }
}
