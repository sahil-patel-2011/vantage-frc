import { assertOrgAuthentication,auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies,headers } from "next/headers";
import { failMeteredAi } from "./metered-ai-fail";

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
    try{await assertOrgAuthentication(client,{userId:session.user.id,orgId,sessionId:session.session.id,authMethod:String((session.session as typeof session.session&{authMethod?:string}).authMethod??"unknown"),rememberedDeviceToken:(await cookies()).get("vantage_mfa_device")?.value});}catch(error){throw new IntelHttpError(403,error instanceof Error?error.message:"Organization authentication policy denied access");}
    return work(client);
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
  return failMeteredAi(error, "Intel request failed");
}
