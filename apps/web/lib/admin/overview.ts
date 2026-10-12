import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { countNewFeedback } from "../feedback/admin-feedback";
import { createWaitlistStore, waitlistBackend } from "../marketing/waitlist";
import { giftNearCap, loadAiCreditOverview, type AdminGift } from "./ai-credits";
import { loadModuleHealth } from "./load-module-health";
import { moduleListItem, summarizeModules } from "./module-health";

/**
 * What the Overview answers: is anything wrong, and is anything waiting on me. Module health,
 * new feedback, the waitlist, teams whose owner hasn't joined, AI credit near or at its cap, and
 * the last things platform admins did. Each part fails on its own: a missing piece shows as
 * "couldn't load", never as zero.
 */

export type OverviewTeamWaiting = {
  orgId: string;
  teamNumber: number | null;
  name: string;
  inviteEmail: string | null;
  inviteExpired: boolean;
};

export type OverviewAction = {
  id: string;
  at: string;
  action: string;
  actorEmail: string | null;
  teamNumber: number | null;
  summary: string;
};

/** "platform_admin.added" → a sentence an operator reads at a glance. */
export function describeAdminAction(row: { action: string; payload: Record<string, unknown>; teamNumber: number | null }): string {
  const team = row.teamNumber != null ? `Team ${row.teamNumber}` : typeof row.payload.teamNumber === "number" ? `Team ${row.payload.teamNumber}` : "a team";
  const email = typeof row.payload.email === "string" ? row.payload.email : "someone";
  const amount = typeof row.payload.amountUsd === "number" || typeof row.payload.amountUsd === "string" ? `$${Number(row.payload.amountUsd).toFixed(2).replace(/\.00$/, "")}` : "";
  switch (row.action) {
    case "platform_admin.added":
      return `Made ${email} a platform admin`;
    case "platform_admin.removed":
      return row.payload.self === true ? "Left Platform admin" : `Removed ${email} from Platform admin`;
    case "platform_admin.transferred":
      return `Handed Platform admin to ${email}`;
    case "ai_credit.gifted":
      return `Gave ${team} ${amount} of AI credit`.replace(/\s+/g, " ");
    case "ai_credit.revoked":
      return `Ended ${team}'s AI credit`;
    case "ai_key.added":
      return `Added AI key "${String(row.payload.label ?? "")}"`;
    case "ai_key.changed":
      return `Changed AI key "${String(row.payload.label ?? "")}"`;
    case "ai_key.removed":
      return `Removed AI key "${String(row.payload.label ?? "")}"`;
    case "organization.provisioned":
      return `Set up ${team}`;
    case "organization.deleted":
      return `Deleted ${team}`;
    case "organization.owner_link_reissued":
      return `Made a new owner link for ${team}`;
    default:
      return row.action.replace(/[._]/g, " ");
  }
}

async function part<T>(client: PoolClient, work: () => Promise<T>): Promise<T | null> {
  return withSavepoint(client, async () => work(), null as T | null);
}

export async function loadAdminOverview(client: PoolClient) {
  const modules = await part(client, () => loadModuleHealth(client));
  const newFeedback = await part(client, () => countNewFeedback(client));

  const teamsWaiting = await part(client, async () =>
    (
      await client.query<OverviewTeamWaiting>(
        `SELECT o.id AS "orgId", o.team_number AS "teamNumber", o.name,
                pending.email AS "inviteEmail", COALESCE(pending.expired, false) AS "inviteExpired"
           FROM organizations o
           LEFT JOIN LATERAL (
             SELECT i.email, (i.status = 'expired' OR i.expires_at <= now()) AS expired
               FROM invites i
              WHERE i.org_id = o.id AND i.role = 'owner' AND i.status IN ('pending', 'expired')
              ORDER BY i.created_at DESC LIMIT 1
           ) pending ON true
          WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.role = 'owner')
          ORDER BY o.created_at DESC
          LIMIT 20`,
      )
    ).rows,
  );

  const credits = await part(client, () => loadAiCreditOverview(client));
  const giftsNeedingEye: AdminGift[] = (credits?.gifts ?? []).filter(
    (gift) => giftNearCap(gift) || (gift.status === "used_up" && gift.refusedCalls > 0),
  );

  const recentActions = await part(client, async () =>
    (
      await client.query<{ id: string; at: string; action: string; actorEmail: string | null; teamNumber: number | null; payload: Record<string, unknown> }>(
        `SELECT a.id, a.created_at::text AS at, a.action, u.email AS "actorEmail", o.team_number AS "teamNumber", a.payload
           FROM admin_actions a
           LEFT JOIN users u ON u.id = a.actor_user_id
           LEFT JOIN organizations o ON o.id = a.target_org_id
          ORDER BY a.created_at DESC
          LIMIT 8`,
      )
    ).rows.map(
      (row): OverviewAction => ({
        id: row.id,
        at: row.at,
        action: row.action,
        actorEmail: row.actorEmail,
        teamNumber: row.teamNumber,
        summary: describeAdminAction({ action: row.action, payload: row.payload ?? {}, teamNumber: row.teamNumber }),
      }),
    ),
  );

  // The waitlist may live outside the database (dev memory store), so it is read on its own.
  let waitlist: { waiting: number } | null = null;
  if (waitlistBackend() !== "unavailable") {
    try {
      const rows = await createWaitlistStore().list({ limit: 500 });
      waitlist = { waiting: rows.filter((row) => !row.convertedAt && !row.launchInvitedAt).length };
    } catch {
      waitlist = null;
    }
  }

  return {
    health: modules
      ? {
          summary: summarizeModules(modules),
          modules: modules.map(moduleListItem),
          checkedAt: modules[0]?.checkedAt ?? new Date().toISOString(),
        }
      : null,
    newFeedback,
    waitlist,
    teamsWaiting,
    credits: credits
      ? {
          setupRequired: credits.setupRequired,
          activeGifts: credits.gifts.filter((gift) => gift.status === "active").length,
          needsEye: giftsNeedingEye,
          degradedKeys: credits.pool.keys.filter((key) => key.enabled && key.degradedAt).map((key) => key.label),
        }
      : null,
    recentActions,
  };
}
