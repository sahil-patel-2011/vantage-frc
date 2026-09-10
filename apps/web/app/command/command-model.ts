import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { CommandSnapshot } from "../../lib/command/types";

export type Me = {
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

export type EventOption = {
  eventKey: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  stateProv: string | null;
  year: number;
};

export const COMMAND_POLL_MS = 20_000;

export function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function teamLabel(teamKey: string, teamNumber?: number | null): string {
  if (teamNumber) return String(teamNumber);
  const match = /^frc(\d+)$/i.exec(teamKey);
  return match ? match[1]! : teamKey;
}

export type CommandHrefs = {
  myDay: string;
  schedule: string;
  strategy: string;
  scouting: string;
  teamData: string;
  matchChecklist: string;
  logistics: string;
  pit: string;
  batteries: string;
  intel: string;
  chemistry: string;
};

export function commandHrefsFromSnap(snap: CommandSnapshot | null, orgId: string | null): CommandHrefs {
  return {
    myDay: snap?.links.myDay ?? hubHref("/competition", "my-day", orgId),
    schedule: snap?.links.schedule ?? withOrgHref("/schedule", orgId),
    strategy: snap?.links.strategy ?? hubHref("/competition", "strategy", orgId),
    scouting: snap?.links.scouting ?? hubHref("/competition", "scouting", orgId),
    teamData: snap?.links.teamData ?? withOrgHref("/team/data", orgId),
    matchChecklist: snap?.links.matchChecklist ?? hubHref("/competition", "match-checklist", orgId),
    logistics: snap?.links.logistics ?? withOrgHref("/logistics", orgId),
    pit: snap?.links.pit ?? withOrgHref("/pit", orgId),
    batteries: snap?.links.batteries ?? withOrgHref("/batteries", orgId),
    intel: snap?.links.intel ?? withOrgHref("/intel", orgId),
    chemistry: snap?.links.chemistry ?? hubHref("/competition", "chemistry", orgId),
  };
}
