import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { strategyCanSync } from "../strategy/strategy-related";

export type BriefingSetupAction = { href: string; label: string };

/**
 * Where the empty briefing should send this person.
 *
 * No team and no event still go to workspace and Event Day. Once an event is
 * set and none of its matches are ours, owners and admins go to Event day, where the event
 * picker is: usually it is the wrong event. (Team Data is sync plumbing, not a fix they can
 * make.) Scouts stay on Scouting.
 */
export function briefingSetupAction(input: {
  orgId?: string | null;
  eventKey?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  /** The event's schedule is out and the team is not on it. */
  notOnSchedule?: boolean;
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
    return {
      href: hubHref("/competition", "command", orgId),
      label: input.notOnSchedule ? "Change event" : "Open Event day",
    };
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
