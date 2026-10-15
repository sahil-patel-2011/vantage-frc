/**
 * Will a resolved chat model actually be allowed to answer? One function, called by the
 * connection check (`probeChatAvailability`) and by the send path (POST /api/agent) right
 * after the adapter resolves, so the two can no longer disagree.
 *
 * Why it exists: the resolver answers with a member's personal key (`member_llm_keys`, incl. keys
 * a teammate shared), a team key, or the platform's free OpenRouter pool, and `meteredAI`
 * (packages/billing/src/index.ts, the key-source block after the kill switch) decides whether
 * that turn may run. Billing used to count only TEAM keys, so on a free team a personal key was
 * refused after Send ("No usable AI connection…"). Billing now counts the caller's own and
 * shared personal keys too (`detectOrgByokKeySource(client, orgId, userId)`), and this gate
 * asks the same question with the same reads.
 *
 * This mirrors that decision with billing's own building blocks (same queries, same order of
 * truth) and no writes: `maybeNotifySponsoredPromoExpired` is never called here.
 * `chat-send-gate.test.ts` runs `meteredAI` against the same fixtures to keep them in step.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { ChatProviderResolutionError, type ResolvedModelSource } from "@vantage/agent";
import { detectOrgByokKeySource, resolveSponsoredPromoForOrg } from "@vantage/billing";

/**
 * Paths `meteredAI` meters without the team-key test: the volunteer swarms (provider
 * petals / ai_horde), a platform gift (provider "vantage-gift") and a paired computer
 * (provider "subscription-bridge").
 */
const UNGATED_SOURCES: ReadonlySet<ResolvedModelSource> = new Set<ResolvedModelSource>([
  "public-swarm",
  "gift",
  "subscription-bridge",
]);

/**
 * Keys billing counts as the team's own spend: an enabled team key or connector, and a member's
 * own or shared personal key (`memberHasUsableKey` in @vantage/billing) — the resolver labels
 * both own and shared personal keys "member-key".
 */
const TEAM_KEY_SOURCES: ReadonlySet<ResolvedModelSource> = new Set<ResolvedModelSource>([
  "org-key",
  "local-connector",
  "member-key",
]);

export type ChatSendBlock = {
  reason: "team_connection_required" | "sponsored_promo_expired";
  message: string;
};

/** What the next step is, decided on the server where the role and the team's keys are known. */
export type ChatConnectionNextStep =
  /** A personal key would work: open the in-chat Connect AI dialog. */
  | "connect"
  /** Only a team connection fixes it, and this member may add one. */
  | "team"
  /** Only a team connection fixes it, and an owner or admin has to add it. */
  | "ask_owner"
  /** Something is set up but not usable (limits, an unreachable provider). */
  | "settings"
  /** The check itself failed. */
  | "retry"
  /** Nothing this team can do in the app (AI not provisioned yet). */
  | "none";

export type ChatConnectionState = {
  configured: boolean;
  reason: string | null;
  message?: string | null;
  nextStep?: ChatConnectionNextStep | null;
};

export const CHAT_READY: ChatConnectionState = { configured: true, reason: null, message: null, nextStep: null };

/** Owners and admins manage the team's shared AI connection (Team → AI keys). */
export function canConnectForTeam(role: string | null | undefined): boolean {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

/**
 * Null when `meteredAI` would accept a call answered from `source`; otherwise why not, in words a
 * student reads. Reads only; throws only when a query does (callers wrap it in a savepoint).
 */
export async function chatSendBlock(
  client: PoolClient,
  input: { orgId: string; userId?: string | null; source: ResolvedModelSource },
): Promise<ChatSendBlock | null> {
  if (UNGATED_SOURCES.has(input.source)) return null;
  // The resolver only labels a model "org-key" / "local-connector" when it came from an enabled
  // org_llm_keys row or an org_provider_configs row with a base URL — exactly what
  // detectOrgByokKeySource counts — so billing always takes these as the team's own key.
  if (TEAM_KEY_SOURCES.has(input.source)) return null;
  const billing = await client.query<{ tier: string }>(
    `SELECT tier FROM org_billing WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const tier = billing.rows[0]?.tier;
  // No billing row is its own refusal ("AI hasn't been turned on"), reported by the caller.
  if (!tier) return null;
  // Paid tiers fall back to hosted credits; their limits are checked elsewhere.
  if (tier !== "free") return null;
  if (await detectOrgByokKeySource(client, input.orgId, input.userId)) return null;
  const promo = await resolveSponsoredPromoForOrg(client, input.orgId);
  if (promo.eligible) return null;
  if (promo.reason === "promo_expired") {
    return {
      reason: "sponsored_promo_expired",
      message: "Vantage's sponsored AI for this team has ended. The team needs its own AI connection to keep asking.",
    };
  }
  return {
    reason: "team_connection_required",
    message:
      input.source === "member-key"
        ? "Your personal key works once this team has its own AI connection. Until then Ask AI can't answer."
        : "This team doesn't have its own AI connection yet, so Ask AI can't answer.",
  };
}

/** The state the composer shows for a refusal, with the next step this member can take. */
export function chatConnectionForBlock(block: ChatSendBlock, role: string | null | undefined): ChatConnectionState {
  return {
    configured: false,
    reason: block.reason,
    message: block.message,
    nextStep: canConnectForTeam(role) ? "team" : "ask_owner",
  };
}

/** Thrown by the send path before any model call, so the refusal reads the same as the check. */
export class ChatSendBlockedError extends ChatProviderResolutionError {
  readonly block: ChatSendBlock;
  constructor(block: ChatSendBlock) {
    super(block.message);
    this.name = "ChatSendBlockedError";
    this.block = block;
  }
}
