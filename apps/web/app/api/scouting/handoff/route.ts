import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import {
  encodeScoutHandoffQr,
  formatHandoffCode,
  normalizeHandoffCode,
  scoutHandoffUserCode,
  type ScoutQrRecord,
} from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

function hashCode(code: string) {
  return createHash("sha256").update(normalizeHandoffCode(code)).digest("hex");
}

function asRecords(payload: unknown): ScoutQrRecord[] {
  if (!Array.isArray(payload)) throw new Error("payload must be an array of scout records");
  if (payload.length < 1 || payload.length > 100) {
    throw new Error("handoff must contain 1–100 scout records");
  }
  return payload as ScoutQrRecord[];
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as { orgId?: string; records?: unknown };
    const records = asRecords(body.records);
    for (const record of records) {
      if (!record?.eventKey || !record?.teamKey || !record?.clientId) {
        throw new Error("Each handoff record needs clientId, eventKey, and teamKey");
      }
    }

    const userCode = scoutHandoffUserCode();
    const result = await withScoutingRequest(body.orgId ?? null, async (client) => {
      const recent = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM scout_handoff_codes
         WHERE org_id = $1::uuid AND created_by = $2::uuid AND created_at > now() - interval '10 minutes'`,
        [body.orgId, session.user.id],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= 12) {
        throw new Error("Too many handoff codes in the last 10 minutes — wait and try again");
      }
      await client.query(
        `INSERT INTO scout_handoff_codes(
           org_id, user_code_hash, created_by, payload, record_count, expires_at
         ) VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5::int, now() + interval '15 minutes')`,
        [body.orgId, hashCode(userCode), session.user.id, JSON.stringify(records), records.length],
      );
      return { userCode: formatHandoffCode(userCode) };
    });

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    const verificationUri = `${base}/scouting?orgId=${encodeURIComponent(body.orgId!)}&handoff=${encodeURIComponent(result.userCode)}`;
    return Response.json({
      userCode: result.userCode,
      recordCount: records.length,
      expiresIn: 900,
      verificationUri,
      qrPayload: encodeScoutHandoffQr(result.userCode, verificationUri),
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const code = url.searchParams.get("code") ?? url.searchParams.get("handoff");
    if (!code) return Response.json({ error: "code is required" }, { status: 400 });
    const compact = normalizeHandoffCode(code);
    if (compact.length !== 8) {
      return Response.json({ error: "Handoff codes are 8 characters (XXXX-XXXX)" }, { status: 400 });
    }

    const redeemed = await withScoutingRequest(orgId, async (client) => {
      await client.query("BEGIN");
      try {
        const result = await client.query<{
          id: string;
          payload: ScoutQrRecord[];
          record_count: number;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          `SELECT id, payload, record_count, expires_at, consumed_at
           FROM scout_handoff_codes
           WHERE org_id = $1::uuid AND user_code_hash = $2
           FOR UPDATE`,
          [orgId, hashCode(compact)],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return { status: "missing" as const };
        }
        if (row.consumed_at) {
          await client.query("ROLLBACK");
          return { status: "consumed" as const };
        }
        if (row.expires_at <= new Date()) {
          await client.query("ROLLBACK");
          return { status: "expired" as const };
        }
        await client.query(
          `UPDATE scout_handoff_codes
           SET consumed_at = now(), consumed_by = $2::uuid
           WHERE id = $1::uuid`,
          [row.id, session.user.id],
        );
        await client.query("COMMIT");
        return {
          status: "ok" as const,
          records: row.payload,
          recordCount: row.record_count,
          code: formatHandoffCode(compact),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    if (redeemed.status === "missing") {
      return Response.json({ error: "Unknown handoff code for this team" }, { status: 404 });
    }
    if (redeemed.status === "consumed") {
      return Response.json({ error: "Handoff code already used", status: "consumed" }, { status: 410 });
    }
    if (redeemed.status === "expired") {
      return Response.json({ error: "Handoff code expired", status: "expired" }, { status: 410 });
    }
    return Response.json({
      status: "ok",
      code: redeemed.code,
      recordCount: redeemed.recordCount,
      records: redeemed.records,
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
