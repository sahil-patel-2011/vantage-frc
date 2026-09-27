import type { PoolClient } from "@neondatabase/serverless";
import { provisioningReady, type ProvisioningStatus } from "./model";
import { isTeamId } from "../nav/remembered-team";

/** Read the actual request's team before falling back to the selected workspace. */
export async function requestedProvisioningTeam(request: Request, remembered: string | null): Promise<string | null> {
  const query = new URL(request.url).searchParams.get("orgId");
  if (isTeamId(query)) return query;
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("content-type")?.includes("application/json")) {
    const reader = request.clone().body?.getReader();
    if (reader) {
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64 * 1024) break;
          chunks.push(value);
        }
        if (size <= 64 * 1024) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const body = JSON.parse(new TextDecoder().decode(bytes)) as { orgId?: unknown };
          if (typeof body.orgId === "string" && isTeamId(body.orgId)) return body.orgId;
        }
      } catch { /* The destination route validates its body. */ }
      finally { void reader.cancel().catch(() => undefined); }
    }
  }
  return isTeamId(remembered) ? remembered : null;
}

export async function pendingProvisioningTeam(client: PoolClient, userId: string, requestedOrg: string | null): Promise<string | null> {
  const orgId = requestedOrg ?? (await client.query<{ orgId: string }>(`SELECT org_id::text AS "orgId" FROM memberships
    WHERE user_id=$1::uuid ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at LIMIT 1`, [userId])).rows[0]?.orgId;
  if (!orgId) return null;
  const job = (await client.query<ProvisioningStatus>(`SELECT state,phase,completed_phases AS "completedPhases",error,
    verified_at::text AS "verifiedAt" FROM team_provisioning_jobs WHERE org_id=$1::uuid`, [orgId])).rows[0];
  // Existing teams have no setup job. Cross-team requests remain subject to RLS.
  return job && !provisioningReady(job) ? orgId : null;
}
