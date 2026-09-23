import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { strategyCanSync } from "../strategy/strategy-related";

export type BriefingSetupAction = { href: string; label: string };

/**
 * Where the empty briefing should send this person.
 *
 * No team and no event still go to workspace and Event Day. Once an event is
 * set, a missing schedule is a Team Data job for owners and admins. Scouts
 * stay on Scouting.
 */
export function briefingSetupAction(input: {
  orgId?: string | null;
  eventKey?: string | null;
  teamNumber?: number | null;
  role?: string | null;
}): BriefingSetupAction {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return { href: "/workspace", label: "Choose your team" };
  }
  if (!input.eventKey) {
    return { href: hubHref("/competition", "command", orgId), label: "Set active event" };
  }
  if (input.teamNumber == null) {
    return { href: withOrgHref("/team", orgId), label: "Open your team" };
  }
  if (strategyCanSync(input.role)) {
    return { href: withOrgHref("/team/data", orgId), label: "Sync Team Data" };
  }
  return { href: hubHref("/competition", "scouting", orgId), label: "Open Scouting" };
}

/**
 * Team Data link on the empty partner-ratings hint.
 * Omitted or any non-owner role fails closed so a scout stays on Scouting.
 */
export function briefingPartnerSyncHref(orgId?: string | null, role?: string | null): string | null {
  if (!strategyCanSync(role)) return null;
  return withOrgHref("/team/data", orgId);
}
