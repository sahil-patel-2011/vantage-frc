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
  return withRls({ userId: session.user.id, orgId }, async (client) => {
    // The role comes back with the membership check, so callers need not read it again.
    const membership = await client.query<{ role: string }>(
      "SELECT role::text AS role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid LIMIT 1",
      [orgId, session.user.id],
    );
    const role = membership.rows[0]?.role;
    if (!role) throw new IntelHttpError(403, "Organization access denied");
    try{await assertOrgAuthentication(client,{userId:session.user.id,orgId,sessionId:session.session.id,authMethod:String((session.session as typeof session.session&{authMethod?:string}).authMethod??"unknown"),rememberedDeviceToken:(await cookies()).get("vantage_mfa_device")?.value});}catch(error){throw new IntelHttpError(403,error instanceof Error?error.message:"Organization authentication policy denied access");}
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
