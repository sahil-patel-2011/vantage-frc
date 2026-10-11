import { sessionIsFresh } from "../../../../lib/team-lifecycle/model";
import {
  AdminRouteError,
  NO_STORE,
  UUID_PATTERN,
  adminErrorResponse,
  asPlatformAdmin,
  isMissingSchema,
  readJsonBody,
} from "../../../../lib/admin/admin-route";
import {
  PlatformAdminError,
  addPlatformAdmin,
  listPlatformAdmins,
  normalizeAdminEmail,
  platformAdminAbilities,
  platformAdminRefusal,
  removePlatformAdmin,
  transferPlatformAdmin,
} from "../../../../lib/admin/platform-admins";

/**
 * Platform admins: who they are (GET), add one or hand the role over (POST), remove one
 * (DELETE). Changes need a sign-in from the last 24 hours; migration 0727 enforces the rest.
 */

function refusal(error: unknown): AdminRouteError | null {
  const mapped = platformAdminRefusal(error);
  return mapped ? new AdminRouteError(mapped.status, mapped.message, mapped.code) : null;
}

export async function GET() {
  try {
    const result = await asPlatformAdmin(async (client, session) => {
      try {
        const admins = await listPlatformAdmins(client, session.user.id);
        return {
          admins,
          abilities: platformAdminAbilities(admins),
          sessionFresh: sessionIsFresh(session.session.createdAt),
          setupRequired: false,
        };
      } catch (error) {
        if (!isMissingSchema(error)) throw error;
        // Before 0727 only your own row is readable: say so instead of a list of one.
        return {
          admins: [],
          abilities: platformAdminAbilities([]),
          sessionFresh: sessionIsFresh(session.session.createdAt),
          setupRequired: true,
        };
      }
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The list of platform admins didn't load. Try again.", refusal);
  }
}

/** `{ action: "add" | "transfer", email }`. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const action = body.action === "transfer" ? "transfer" : body.action === "add" ? "add" : null;
    if (!action) throw new AdminRouteError(400, "Choose whether to add someone or hand Platform admin over.");
    const result = await asPlatformAdmin(
      async (client, session) => {
        const email = normalizeAdminEmail(body.email);
        if (action === "transfer" && email === session.user.email.trim().toLowerCase()) {
          throw new PlatformAdminError("self");
        }
        const userId = action === "add" ? await addPlatformAdmin(client, email) : await transferPlatformAdmin(client, email);
        return { userId, email, action };
      },
      { fresh: true },
    );
    return Response.json(
      {
        ...result,
        // After a transfer you are no longer an admin: the page sends you home.
        next: result.action === "transfer" ? "/" : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return adminErrorResponse(error, "Nothing changed. Try again in a minute.", refusal);
  }
}

/** `{ userId }`. Removing yourself is allowed while another admin remains. */
export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody(request);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!UUID_PATTERN.test(userId)) throw new AdminRouteError(400, "Choose an admin from the list.");
    const self = await asPlatformAdmin(
      async (client, session) => {
        await removePlatformAdmin(client, userId);
        return userId === session.user.id;
      },
      { fresh: true },
    );
    return Response.json({ removed: userId, next: self ? "/" : null }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "Nothing changed. Try again in a minute.", refusal);
  }
}
