import {
  BYOK_MODEL_OPTIONS,
  normalizeOrgModelPolicy,
  type OrgModelPolicy,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { sanitizeAllowedModelIds } from "../../../../lib/ai-keys/model-policy-related";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

/**
 * Org model SELECTION policy (`org_model_policy`): which models members may
 * pick, app-wide. Not billing's spend limits (`org_api_model_limits`).
 * GET — any member: {mode, allowedModelIds, catalog, canManage}.
 * PUT — owner/admin only: update mode + allowlist.
 */

const updateLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "model-policy" });

const updateSchema = z
  .object({
    orgId: z.string().uuid(),
    mode: z.enum(["allow_all", "allowlist", "force_auto"]),
    allowedModelIds: z.array(z.string().min(1).max(200)).max(64).optional(),
  })
  .strict();

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

const catalogPayload = () =>
  BYOK_MODEL_OPTIONS.map((m) => ({
    id: m.id,
    provider: m.provider,
    modelId: m.modelId,
    label: m.label,
    tier: m.tier,
    tierLabel: m.tierLabel,
  }));

type PolicyRow = { mode: string; allowedModelIds: string[] | null };

/** Tolerates a pre-0443 deploy without the table: allow-everything default. */
async function loadPolicy(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  orgId: string,
): Promise<OrgModelPolicy> {
  try {
    const row = (
      await client.query<PolicyRow>(
        `SELECT mode, allowed_model_ids AS "allowedModelIds"
           FROM org_model_policy
          WHERE org_id = $1::uuid`,
        [orgId],
      )
    ).rows[0];
    return normalizeOrgModelPolicy(row ?? null);
  } catch {
    return normalizeOrgModelPolicy(null);
  }
}

export async function GET(request: Request) {
  const userId = await currentUser();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim();
  if (!orgId || !z.string().uuid().safeParse(orgId).success) {
    return Response.json({ error: "A valid orgId is required" }, { status: 400 });
  }
  try {
    const payload = await withRls({ userId, orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      const role = membership.rows[0]?.role;
      if (!role) throw new Error("Organization access denied");
      const policy = await loadPolicy(client, orgId);
      return {
        mode: policy.mode,
        allowedModelIds: policy.allowedModelIds,
        canManage: role === "owner" || role === "admin",
      };
    });
    return privateJson({ ...payload, catalog: catalogPayload() });
  } catch (error) {
    return securityErrorResponse(error, "Could not load the model policy.");
  }
}

export async function PUT(request: Request) {
  const userId = await currentUser();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    if (!(await updateLimiter.allow(`${userId}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many model policy updates. Wait a moment and try again.");
    }
    const body = await parseSecureJson(request, updateSchema);
    const allowedModelIds =
      body.mode === "allowlist"
        ? sanitizeAllowedModelIds(body.allowedModelIds ?? [], BYOK_MODEL_OPTIONS)
        : [];

    const saved = await withRls({ userId, orgId: body.orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [body.orgId, userId],
      );
      const role = membership.rows[0]?.role;
      if (role !== "owner" && role !== "admin") {
        throw new Error("Only team owners or admins can change the model policy.");
      }
      try {
        // RLS additionally enforces has_org_role(owner/admin) on INSERT/UPDATE.
        await client.query(
          `INSERT INTO org_model_policy (org_id, mode, allowed_model_ids, updated_by, updated_at)
           VALUES ($1::uuid, $2, $3::text[], $4::uuid, now())
           ON CONFLICT (org_id) DO UPDATE
             SET mode = EXCLUDED.mode,
                 allowed_model_ids = EXCLUDED.allowed_model_ids,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()`,
          [body.orgId, body.mode, allowedModelIds, userId],
        );
      } catch (error) {
        // 42P01 = relation does not exist (pre-0443 deploy) — honest setup state.
        if ((error as { code?: string }).code === "42P01") {
          throw new Error(
            "Model policy storage is not available yet. Run database migration 0443_org_model_policy, then retry.",
            { cause: error },
          );
        }
        throw error;
      }
      return normalizeOrgModelPolicy({ mode: body.mode, allowedModelIds });
    });

    return privateJson({
      mode: saved.mode,
      allowedModelIds: saved.allowedModelIds,
      canManage: true,
      catalog: catalogPayload(),
    });
  } catch (error) {
    return securityErrorResponse(error, "Could not update the model policy.");
  }
}
