import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { dbAdmin } from "@vantage/db/admin";
import {
  dataSourceCredentials,
  dataSourceHealth,
  orgLiveSubscriptions,
} from "@vantage/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type TbaCredential,
  type TbaCredentialStore,
} from "./live-coordinator";
import { readPlatformTbaAuthKey } from "./platform-key";

type CredentialRow = {
  opaqueKeyId: string;
  encryptedSecret: string;
  orgId: string | null;
};

async function decryptRow(row: CredentialRow): Promise<TbaCredential | null> {
  try {
    const parsed = JSON.parse(row.encryptedSecret) as EncryptedSecret;
    const secret = await decryptSecret(parsed, createKms());
    if (!secret.trim()) return null;
    return {
      opaqueId: row.opaqueKeyId,
      secret: secret.trim(),
      scope: row.orgId ? "org" : "platform",
      orgId: row.orgId ?? undefined,
    };
  } catch {
    return null;
  }
}

export class NeonTbaCredentialStore implements TbaCredentialStore {
  async platform(): Promise<TbaCredential | null> {
    const [row] = await dbAdmin
      .select({
        opaqueKeyId: dataSourceCredentials.opaqueKeyId,
        encryptedSecret: dataSourceCredentials.encryptedSecret,
        orgId: dataSourceCredentials.orgId,
      })
      .from(dataSourceCredentials)
      .where(
        and(
          eq(dataSourceCredentials.source, "tba"),
          isNull(dataSourceCredentials.orgId),
          isNull(dataSourceCredentials.disabledAt),
        ),
      )
      .limit(1);

    if (row) {
      const credential = await decryptRow(row);
      if (credential) return credential;
    }

    const envKey = readPlatformTbaAuthKey();
    if (!envKey) return null;
    return {
      opaqueId: "env:TBA_AUTH_KEY",
      secret: envKey,
      scope: "platform",
    };
  }

  async fallbackForOrgs(orgIds: string[]): Promise<TbaCredential[]> {
    const unique = [...new Set(orgIds.filter(Boolean))];
    if (!unique.length) return [];

    const subscriptions = await dbAdmin
      .select({
        orgId: orgLiveSubscriptions.orgId,
        fallbackCredentialId: orgLiveSubscriptions.fallbackCredentialId,
      })
      .from(orgLiveSubscriptions)
      .where(
        and(
          eq(orgLiveSubscriptions.enabled, true),
          inArray(orgLiveSubscriptions.orgId, unique),
        ),
      );

    const preferredIds = subscriptions
      .map((row) => row.fallbackCredentialId)
      .filter((id): id is string => Boolean(id));

    const rows = await dbAdmin
      .select({
        id: dataSourceCredentials.id,
        opaqueKeyId: dataSourceCredentials.opaqueKeyId,
        encryptedSecret: dataSourceCredentials.encryptedSecret,
        orgId: dataSourceCredentials.orgId,
      })
      .from(dataSourceCredentials)
      .where(
        and(
          eq(dataSourceCredentials.source, "tba"),
          isNull(dataSourceCredentials.disabledAt),
          inArray(dataSourceCredentials.orgId, unique),
        ),
      );

    const preferred = new Set(preferredIds);
    const ordered = [
      ...rows.filter((row) => preferred.has(row.id)),
      ...rows.filter((row) => !preferred.has(row.id)),
    ];

    const credentials: TbaCredential[] = [];
    const seen = new Set<string>();
    for (const row of ordered) {
      if (seen.has(row.opaqueKeyId)) continue;
      const credential = await decryptRow(row);
      if (!credential) continue;
      seen.add(row.opaqueKeyId);
      credentials.push(credential);
    }
    return credentials;
  }

  async recordHealth(input: {
    status: "healthy" | "degraded" | "unavailable";
    opaqueId?: string;
    httpStatus?: number;
    error?: string;
    nextAttemptAt?: Date;
  }): Promise<void> {
    const now = new Date();
    const success = input.status === "healthy";
    await dbAdmin
      .insert(dataSourceHealth)
      .values({
        source: "tba",
        status: input.status,
        requestsLastHour: 1,
        consecutiveFailures: success ? 0 : 1,
        lastSuccessAt: success ? now : null,
        lastFailureAt: success ? null : now,
        nextAttemptAt: input.nextAttemptAt ?? null,
        keySourceOpaqueId: input.opaqueId ?? null,
        details: {
          httpStatus: input.httpStatus ?? null,
          error: input.error ?? null,
        },
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dataSourceHealth.source,
        set: {
          status: input.status,
          requestsLastHour: sql`${dataSourceHealth.requestsLastHour} + 1`,
          consecutiveFailures: success
            ? 0
            : sql`${dataSourceHealth.consecutiveFailures} + 1`,
          lastSuccessAt: success
            ? now
            : sql`${dataSourceHealth.lastSuccessAt}`,
          lastFailureAt: success
            ? sql`${dataSourceHealth.lastFailureAt}`
            : now,
          nextAttemptAt: input.nextAttemptAt ?? null,
          keySourceOpaqueId:
            input.opaqueId ?? sql`${dataSourceHealth.keySourceOpaqueId}`,
          details: {
            httpStatus: input.httpStatus ?? null,
            error: input.error ?? null,
          },
          updatedAt: now,
        },
      });
  }
}

export async function listLiveFallbackOrgIds(): Promise<string[]> {
  const rows = await dbAdmin
    .select({ orgId: orgLiveSubscriptions.orgId })
    .from(orgLiveSubscriptions)
    .where(eq(orgLiveSubscriptions.enabled, true));
  return rows.map((row) => row.orgId);
}

export async function recordIngestSummary(details: Record<string, unknown>) {
  const now = new Date();
  await dbAdmin
    .insert(dataSourceHealth)
    .values({
      source: "tba",
      status: "healthy",
      requestsLastHour: 0,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastFailureAt: null,
      nextAttemptAt: null,
      keySourceOpaqueId: null,
      details,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dataSourceHealth.source,
      set: {
        status: "healthy",
        consecutiveFailures: 0,
        lastSuccessAt: now,
        details,
        updatedAt: now,
      },
    });
}
