import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type PairwiseNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export function pairwiseNextActions(ctx: {
  orgId?: string | null;
  comparisonCount?: number;
  rankCount?: number;
  eventKey?: string | null;
}): PairwiseNextAction[] {
  const orgId = ctx.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before ranking robots.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: PairwiseNextAction[] = [];
  if ((ctx.comparisonCount ?? 0) === 0) {
    actions.push({
      id: "first-tap",
      label: "Tap who looked better",
      detail: "Ranks stay empty until a scout records a real A-beats-B comparison.",
      href: withOrgHref("/pairwise", orgId),
      primary: true,
    });
  }

  if (!ctx.eventKey) {
    actions.push({
      id: "event",
      label: "Set the active event",
      detail: "Event teams fill the picker from the TBA cache — no invented field list.",
      href: hubHref("/competition", "command", orgId),
    });
  }

  actions.push({
    id: "scouting",
    label: "Open match scouting",
    detail: "Pairwise is qualitative. Cycle counts and climb calls still live on Scouting forms.",
    href: hubHref("/competition", "scouting", orgId),
  });
  actions.push({
    id: "pick-clock",
    label: "Open pick clock",
    detail: "Use these ranks at the draft desk — they are not TBA EPA.",
    href: hubHref("/competition", "pick-clock", orgId),
  });
  actions.push({
    id: "chemistry",
    label: "Open alliance chemistry",
    detail: "Chemistry scores partner fit from scouted roles; Pairwise ranks feel and driving.",
    href: hubHref("/competition", "chemistry", orgId),
  });
  return actions.slice(0, 5);
}
