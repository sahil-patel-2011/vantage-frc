import { assertOrgAuthentication, type auth } from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { RequestSecurityError } from "../security/request";

export async function assertCoverageSession(client: PoolClient, session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>, orgId: string) {
  const member = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid", [orgId, session.user.id]);
  if (!member.rowCount) throw new RequestSecurityError(403, "Team access changed. Choose a team you belong to.");
  try {
    await assertOrgAuthentication(client, { userId: session.user.id, orgId, sessionId: session.session.id,
      authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
      rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "sign_in_method_not_allowed" || code === "mfa_enrollment_required" || code === "mfa_step_up_required") {
      throw new RequestSecurityError(403, error instanceof Error ? error.message : "Re-authenticate to meet your team's current sign-in requirements.");
    }
    throw error;
  }
}
