import { assertOrgAuthentication,auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies,headers } from "next/headers";

export async function withScoutingRequest<T>(
  orgId: string | null,
  work: Parameters<typeof withRls<T>>[1],
): Promise<T> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ScoutingHttpError(401, "Authentication required");
  if (!orgId) throw new ScoutingHttpError(400, "orgId is required");
  return withRls({ userId: session.user.id, orgId }, async (client) => {
    const membership = await client.query(
      "SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2",
      [orgId, session.user.id],
    );
    if (!membership.rowCount) throw new ScoutingHttpError(403, "Organization access denied");
    try{await assertOrgAuthentication(client,{userId:session.user.id,orgId,sessionId:session.session.id,authMethod:String((session.session as typeof session.session&{authMethod?:string}).authMethod??"unknown"),rememberedDeviceToken:(await cookies()).get("vantage_mfa_device")?.value});}catch(error){throw new ScoutingHttpError(403,error instanceof Error?error.message:"Organization authentication policy denied access");}
    return work(client);
  });
}

export class ScoutingHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function scoutingErrorResponse(error: unknown) {
  const status = error instanceof ScoutingHttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Scouting request failed" },
    { status },
  );
}
