import {
  assertPlatformAdmin,
  auth,
  platformAdminDeniedResponse,
  writeAdminAction,
} from "@vantage/core";
import {
  describeFreeRelayRefusal,
  freeRelayRefusal,
  freebuffSelectableCatalog,
  readFreeRelayConfig,
} from "@vantage/agent";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  generateFreeRelayDeviceKey,
  hashFreeRelayDeviceKey,
  PLATFORM_FREEBUFF_RELAY_NAME,
  probeFreeRelayStats,
} from "../../../../lib/admin/free-relay-devices";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

function missingTable(error: unknown): boolean {
  return error instanceof Error && /free_relay_devices/.test(error.message);
}

export async function GET() {
  try {
    const current = await session();
    const data = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      const config = readFreeRelayConfig();
      const refusal = freeRelayRefusal();
      const live = config
        ? await probeFreeRelayStats({ baseUrl: config.baseUrl, apiKey: config.apiKey })
        : null;
      let devices: Array<Record<string, unknown>> = [];
      try {
        const rows = await client.query(
          `SELECT id, name, last_seen_at AS "lastSeenAt", last_probe_at AS "lastProbeAt",
                  last_probe_ok AS "lastProbeOk", last_probe_error AS "lastProbeError",
                  tokens_day AS "tokensDay", tokens_in_today AS "tokensInToday",
                  tokens_out_today AS "tokensOutToday", tokens_out_per_sec AS "tokensOutPerSec",
                  active_requests AS "activeRequests", max_concurrent AS "maxConcurrent",
                  model, bind_label AS "bindLabel", upstream_ok AS "upstreamOk",
                  created_at AS "createdAt", revoked_at AS "revokedAt"
             FROM free_relay_devices
            ORDER BY revoked_at NULLS FIRST, created_at DESC`,
        );
        devices = rows.rows;
      } catch (error) {
        if (!missingTable(error)) throw error;
      }
      return {
        relay: {
          configured: Boolean(config),
          model: config?.model ?? null,
          models: freebuffSelectableCatalog(),
          refusal: refusal ? describeFreeRelayRefusal(refusal) : null,
        },
        live,
        devices,
      };
    });
    return Response.json(data);
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

type Body = {
  action?: string;
  name?: string;
  deviceId?: string;
};

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Body;
    const result = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      if (body.action === "ensure_platform") {
        const existing = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM free_relay_devices
            WHERE lower(btrim(name)) = lower($1) AND revoked_at IS NULL
            LIMIT 1`,
          [PLATFORM_FREEBUFF_RELAY_NAME],
        );
        if (existing.rows[0]) {
          return { id: existing.rows[0].id, name: existing.rows[0].name, existing: true };
        }
        const key = generateFreeRelayDeviceKey();
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO free_relay_devices (name, key_hash, created_by)
           VALUES ($1, $2, $3::uuid)
           RETURNING id`,
          [PLATFORM_FREEBUFF_RELAY_NAME, hashFreeRelayDeviceKey(key), current.user.id],
        );
        await writeAdminAction(client, {
          actorUserId: current.user.id,
          action: "free_relay.device_created",
          payload: { deviceId: inserted.rows[0]!.id, name: PLATFORM_FREEBUFF_RELAY_NAME, platform: true },
        });
        return { id: inserted.rows[0]!.id, name: PLATFORM_FREEBUFF_RELAY_NAME, key };
      }
      if (body.action === "create") {
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (!name) throw new Error("Device name is required");
        const key = generateFreeRelayDeviceKey();
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO free_relay_devices (name, key_hash, created_by)
           VALUES ($1, $2, $3::uuid)
           RETURNING id`,
          [name, hashFreeRelayDeviceKey(key), current.user.id],
        );
        await writeAdminAction(client, {
          actorUserId: current.user.id,
          action: "free_relay.device_created",
          payload: { deviceId: inserted.rows[0]!.id, name },
        });
        return { id: inserted.rows[0]!.id, name, key };
      }
      if (body.action === "revoke") {
        const deviceId = String(body.deviceId ?? "");
        if (!deviceId) throw new Error("deviceId is required");
        await client.query(
          `UPDATE free_relay_devices SET revoked_at = now()
            WHERE id = $1::uuid AND revoked_at IS NULL`,
          [deviceId],
        );
        await writeAdminAction(client, {
          actorUserId: current.user.id,
          action: "free_relay.device_revoked",
          payload: { deviceId },
        });
        return { revoked: true };
      }
      if (body.action === "probe") {
        const config = readFreeRelayConfig();
        if (!config) throw new Error("FREE_RELAY_BASE_URL is not configured on this deployment.");
        const live = await probeFreeRelayStats({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        if (body.deviceId) {
          await client.query(
            `UPDATE free_relay_devices SET
               last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END,
               last_probe_at = now(),
               last_probe_ok = $2,
               last_probe_error = $3,
               tokens_day = $4::date,
               tokens_in_today = $5,
               tokens_out_today = $6,
               tokens_out_per_sec = $7,
               active_requests = $8,
               max_concurrent = $9,
               model = $10,
               bind_label = $11,
               upstream_ok = $12
             WHERE id = $1::uuid`,
            [
              body.deviceId,
              live.ok,
              live.error,
              live.tokensDay,
              live.tokensIn,
              live.tokensOut,
              live.tokensOutPerSec,
              live.activeRequests,
              live.maxConcurrent || null,
              live.model,
              live.bind,
              live.upstreamOk,
            ],
          );
        }
        return { live };
      }
      throw new Error("Unknown action");
    });
    return Response.json(result);
  } catch (error) {
    if (missingTable(error)) {
      return Response.json(
        { error: "Run migration 0520_free_relay_devices.sql before registering a Pi." },
        { status: 400 },
      );
    }
    return platformAdminDeniedResponse(error);
  }
}
