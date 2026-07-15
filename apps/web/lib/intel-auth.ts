import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export class IntelHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function withIntelRequest<T>(
  orgId: string | null,
  work: Parameters<typeof withRls<T>>[1],
): Promise<T> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new IntelHttpError(401, "Authentication required");
  if (!orgId) throw new IntelHttpError(400, "orgId is required");
  return withRls({ userId: session.user.id, orgId }, async (client) => {
    const membership = await client.query(
      "SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2",
      [orgId, session.user.id],
    );
    if (!membership.rowCount) throw new IntelHttpError(403, "Organization access denied");
    return work(client);
  });
}

export async function intelSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new IntelHttpError(401, "Authentication required");
  return session;
}

export function intelErrorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Intel request failed" },
    { status: error instanceof IntelHttpError ? error.status : 400 },
  );
}
