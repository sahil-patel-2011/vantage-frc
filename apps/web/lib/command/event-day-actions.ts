import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { CommandSnapshot } from "./types";

export type EventDayNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Prioritized next actions for Event Day Command / My Day.
 * Never invents DEMO match times, win rates, or scout coverage.
 */
export function eventDayNextActions(
  snap: Pick<
    CommandSnapshot,
    | "orgId"
    | "eventKey"
    | "tbaConfigured"
    | "status"
    | "matches"
    | "scoutQueue"
    | "coverage"
    | "prediction"
    | "myDay"
    | "links"
    | "canSetEvent"
  > | null,
  options?: { orgId?: string | null },
): EventDayNextAction[] {
  const orgId = snap?.orgId ?? options?.orgId ?? null;
  const actions: EventDayNextAction[] = [];

  if (!orgId) {
    actions.push({
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization before loading Event Day.",
      href: "/workspace",
      primary: true,
    });
    return actions;
  }

  if (!snap?.eventKey) {
    actions.push({
      id: "event",
      label: "Set active event",
      detail: "Pick the TBA event so match time, alliances, and bumper cues can load.",
      href: snap?.canSetEvent ? withOrgHref("/command", orgId) : withOrgHref("/workspace", orgId),
      primary: true,
    });
  }

  if (snap?.tbaConfigured === false) {
    actions.push({
      id: "tba",
      label: "Configure TBA sync",
      detail: "Sync schedule under Team → Data. Event Day never fabricates match times.",
      href: snap?.links.teamData ?? withOrgHref("/team/data", orgId),
      primary: !snap?.eventKey ? false : true,
    });
  }

  const next = snap?.matches[0] ?? null;
  if (snap?.eventKey && !next) {
    actions.push({
      id: "schedule",
      label: "Check schedule sync",
      detail: "No upcoming match in saved rankings cache yet — refresh TBA after the event posts.",
      href: snap.links.schedule ?? withOrgHref("/schedule", orgId),
      primary: snap.tbaConfigured !== false,
    });
  }

  if (next) {
    actions.push({
      id: "checklist",
      label: "Pre-match checklist",
      detail: `${next.compLevel.toUpperCase()} ${next.matchNumber} — bumpers, pit release, and drive-team readiness.`,
      href: snap?.links.matchChecklist ?? hubHref("/competition", "match-checklist", orgId),
      primary: true,
    });
  }

  if ((snap?.coverage.upcomingUnscouted ?? 0) > 0 || (snap?.scoutQueue.length ?? 0) > 0) {
    const gaps = snap?.coverage.upcomingUnscouted ?? snap?.scoutQueue.length ?? 0;
    actions.push({
      id: "scout",
      label: gaps === 1 ? "Scout 1 coverage gap" : `Scout ${gaps} coverage gaps`,
      detail: "Partners and opponents in upcoming alliances still need match/pit coverage.",
      href: snap?.links.scouting ?? hubHref("/competition", "scouting", orgId),
      primary: !next,
    });
  }

  if (snap?.prediction.status !== "live") {
    actions.push({
      id: "strategy",
      label: "Open strategy",
      detail: "Labeled win/loss and playbook when schedule + metrics exist.",
      href: snap?.links.strategy ?? hubHref("/competition", "strategy", orgId),
    });
  } else {
    actions.push({
      id: "strategy",
      label: "Review matchup",
      detail: "Full strategy desk for this alliance — partners, opponents, and cited factors.",
      href: snap?.links.strategy ?? hubHref("/competition", "strategy", orgId),
    });
  }

  if (snap?.myDay) {
    actions.push({
      id: "my-day",
      label: "Open My Day",
      detail: snap.myDay.bumperCue ?? "Personal match times, bumper cue, and travel strip.",
      href: snap.myDay.href || snap.links.myDay || hubHref("/competition", "my-day", orgId),
    });
  } else {
    actions.push({
      id: "my-day",
      label: "Open My Day",
      detail: "Personal schedule glance for your matches at this event.",
      href: snap?.links.myDay ?? hubHref("/competition", "my-day", orgId),
    });
  }

  const missingTravel =
    snap?.myDay != null && !snap.myDay.lodgingLabel && !snap.myDay.nextTravelLabel;
  if (missingTravel || (snap?.eventKey && !snap.myDay?.lodgingLabel && !snap.myDay?.nextTravelLabel)) {
    actions.push({
      id: "logistics",
      label: "Open Logistics",
      detail: "Hotels and leave times stay blank until mentors publish a trip.",
      href: snap?.links.logistics ?? withOrgHref("/logistics", orgId),
    });
  }

  return actions.slice(0, 5);
}
