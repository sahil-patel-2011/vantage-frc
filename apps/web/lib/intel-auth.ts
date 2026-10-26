import type { PoolClient } from "@neondatabase/serverless";
import { assertOrgAuthentication,auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies,headers } from "next/headers";
import { failMeteredAi } from "./metered-ai-fail";

export class IntelHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Who is asking, from the checks withIntelRequest already ran — no second session read. */
export type IntelRequestContext = { userId: string; role: string };

export async function withIntelRequest<T>(
  orgId: string | null,
  work: (client: PoolClient, context: IntelRequestContext) => Promise<T>,
): Promise<T> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new IntelHttpError(401, "Authentication required");
  if (!orgId) throw new IntelHttpError(400, "orgId is required");
  const rememberedDeviceToken = (await cookies()).get("vantage_mfa_device")?.value;
  return withRls({ userId: session.user.id, orgId }, async (client) => {
    // Membership and the sign-in policy do not depend on each other. The cookie
    // was read before this transaction so both queries share one round trip.
    const membershipP = client.query<{ role: string }>(
      "SELECT role::text AS role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid LIMIT 1",
      [orgId, session.user.id],
    );
    const authP = assertOrgAuthentication(client, {
      userId: session.user.id,
      orgId,
      sessionId: session.session.id,
      authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
      rememberedDeviceToken,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const [membership, authError] = await Promise.all([membershipP, authP]);
    const role = membership.rows[0]?.role;
    if (!role) throw new IntelHttpError(403, "Organization access denied");
    if (authError) {
      throw new IntelHttpError(403, authError instanceof Error ? authError.message : "Organization authentication policy denied access");
    }
    return work(client, { userId: session.user.id, role });
  });
}

export async function intelSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new IntelHttpError(401, "Authentication required");
  return session;
}

export function intelErrorResponse(error: unknown) {
  if (error instanceof IntelHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return failMeteredAi(error, "Research request failed");
}
