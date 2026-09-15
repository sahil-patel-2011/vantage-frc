import {
  auth,
  createTeamJoinLink,
  listTeamJoinLinks,
  revokeTeamJoinLink,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

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

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new HttpError(400, "Team is required");
    const links = await withRls({ userId: session.user.id, orgId }, (client) =>
      listTeamJoinLinks(client, orgId),
    );
    return Response.json({ links });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load join links" },
      { status },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      action?: string;
      id?: string;
      maxUses?: number;
      memberRole?: "scout" | "viewer";
    };
    const orgId = String(body.orgId ?? "").trim();
    if (!orgId) throw new HttpError(400, "Team is required");

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const action = body.action === "revoke" ? "revoke" : "create";
      switch (action) {
        case "create":
          return createTeamJoinLink(client, session.user.id, {
            orgId,
            maxUses: body.maxUses,
            memberRole: body.memberRole,
          });
        case "revoke": {
          const id = String(body.id ?? "").trim();
          if (!id) throw new HttpError(400, "Join link is required");
          await revokeTeamJoinLink(client, session.user.id, { orgId, id });
          return { ok: true };
        }
        default: {
          const exhaustive: never = action;
          throw new HttpError(400, `Unsupported join-link action: ${String(exhaustive)}`);
        }
      }
    });
    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update the join link" },
      { status },
    );
  }
}
