import { randomUUID } from "node:crypto";
import { assertPlatformAdmin, assertPlatformPrivilegeMfa, auth, PlatformAdminRequiredError } from "@vantage/core";
import { createKms, decryptSecret, encryptSecret, type EncryptedSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { TbaClient } from "@vantage/reference";
import { headers } from "next/headers";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

async function authorize(
  client: import("@neondatabase/serverless").PoolClient,
  userId: string,
  orgId: string | null,
) {
  if (orgId) {
    const role = await client.query(
      `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
      [orgId, userId],
    );
    if (!role.rowCount) throw new Error("Organization administrator access required");
  } else {
    await assertPlatformAdmin(client);
  }
}

function responseError(error: unknown) {
  if (error instanceof PlatformAdminRequiredError) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : "Connector action failed";
  if (/authentication required/i.test(message)) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (/platform administrator/i.test(message)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (/organization administrator/i.test(message)) {
    return Response.json({ error: message }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const orgId = new URL(request.url).searchParams.get("orgId");
    const data = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      await authorize(client, session.user.id, orgId);
      return {
        credentials: (
          await client.query(
            `SELECT id,source,opaque_key_id AS "opaqueKeyId",status,last_tested_at AS "lastTestedAt",last_test_status AS "lastTestStatus",disabled_at AS "disabledAt",updated_at AS "updatedAt" FROM data_source_credentials WHERE source='tba' AND org_id IS NOT DISTINCT FROM $1`,
            [orgId],
          )
        ).rows,
        health:
          (
            await client.query(
              `SELECT source,status,requests_last_hour AS "requestsLastHour",rate_limit_remaining AS "rateLimitRemaining",consecutive_failures AS "consecutiveFailures",last_success_at AS "lastSuccessAt",last_failure_at AS "lastFailureAt",next_attempt_at AS "nextAttemptAt",updated_at AS "updatedAt" FROM data_source_health WHERE source='tba'`,
            )
          ).rows[0] ?? null,
      };
    });
    return Response.json(data);
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      orgId?: string;
      action: "save" | "test" | "disable";
      credentialId?: string;
      apiKey?: string;
    };
    const orgId = body.orgId ?? null;
    const result = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      await authorize(client, session.user.id, orgId);
      if (!orgId) {
        await assertPlatformPrivilegeMfa(client, { userId: session.user.id, sessionId: session.session.id });
      }
      if (body.action === "save") {
        if (!body.apiKey?.trim()) throw new Error("TBA Read API key is required");
        const encrypted = await encryptSecret(body.apiKey.trim(), createKms());
        const opaqueId = `tba_${randomUUID()}`;
        if (orgId) {
          await client.query(
            `INSERT INTO data_source_credentials(org_id,source,opaque_key_id,encrypted_secret,status,created_by,updated_by) VALUES($1,'tba',$2,$3,'untested',$4,$4) ON CONFLICT(source,org_id) WHERE org_id IS NOT NULL DO UPDATE SET opaque_key_id=excluded.opaque_key_id,encrypted_secret=excluded.encrypted_secret,status='untested',disabled_at=NULL,updated_by=excluded.updated_by,updated_at=now()`,
            [orgId, opaqueId, JSON.stringify(encrypted), session.user.id],
          );
        } else {
          await client.query(
            `INSERT INTO data_source_credentials(org_id,source,opaque_key_id,encrypted_secret,status,created_by,updated_by) VALUES(NULL,'tba',$1,$2,'untested',$3,$3) ON CONFLICT(source) WHERE org_id IS NULL DO UPDATE SET opaque_key_id=excluded.opaque_key_id,encrypted_secret=excluded.encrypted_secret,status='untested',disabled_at=NULL,updated_by=excluded.updated_by,updated_at=now()`,
            [opaqueId, JSON.stringify(encrypted), session.user.id],
          );
        }
        return { success: true, opaqueKeyId: opaqueId };
      }
      const credential = await client.query<{ encrypted_secret: string }>(
        `SELECT encrypted_secret FROM data_source_credentials WHERE id=$1 AND org_id IS NOT DISTINCT FROM $2`,
        [body.credentialId, orgId],
      );
      if (!credential.rows[0]) throw new Error("Credential not found");
      if (body.action === "disable") {
        await client.query(
          `UPDATE data_source_credentials SET disabled_at=now(),status='disabled',updated_by=$2,updated_at=now() WHERE id=$1`,
          [body.credentialId, session.user.id],
        );
        return { success: true };
      }
      const secret = await decryptSecret(JSON.parse(credential.rows[0].encrypted_secret) as EncryptedSecret, createKms());
      try {
        const check = await new TbaClient({ authKey: secret, maxRetries: 0 }).get("status");
        await client.query(
          `UPDATE data_source_credentials SET status='healthy',last_tested_at=now(),last_test_status=$2,updated_by=$3,updated_at=now() WHERE id=$1`,
          [body.credentialId, check.status, session.user.id],
        );
        return { success: true, status: check.status };
      } catch (error) {
        await client.query(
          `UPDATE data_source_credentials SET status='failed',last_tested_at=now(),last_test_status=$2,updated_by=$3,updated_at=now() WHERE id=$1`,
          [
            body.credentialId,
            error && typeof error === "object" && "status" in error ? Number((error as { status: unknown }).status) : null,
            session.user.id,
          ],
        );
        throw new Error("TBA key test failed. Rotate or verify the Read API v3 key.", { cause: error });
      }
    });
    return Response.json(result);
  } catch (error) {
    return responseError(error);
  }
}
