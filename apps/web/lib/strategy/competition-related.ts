import { hubHref } from "../nav/hubs";

/** Soft-UI related Competition surfaces for Event Day / Strategy / picks. */
export const COMPETITION_RELATED_LINKS = [
  { id: "command", label: "Event Day", tab: "command" },
  { id: "my-day", label: "My Day", tab: "my-day" },
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "forms", label: "Form builder", tab: "forms" },
  { id: "match-checklist", label: "Match checklist", tab: "match-checklist" },
  { id: "pick-clock", label: "Pick clock", tab: "pick-clock" },
  { id: "chemistry", label: "Chemistry", tab: "chemistry" },
  { id: "alliance-desk", label: "Alliance desk", href: "/alliance-selection-desk" },
  { id: "draft", label: "Draft board", href: "/strategy/draft" },
  { id: "coverage", label: "Scout coverage", href: "/scout-coverage-live" },
] as const;

export type CompetitionRelatedId = (typeof COMPETITION_RELATED_LINKS)[number]["id"];

export type CompetitionRelatedLink = {
  id: CompetitionRelatedId;
  label: string;
  href: string;
};

function withOrg(path: string, orgId?: string | null, extra?: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Cross-links between Competition Soft-UI surfaces (never DEMO placeholders). */
export function competitionRelatedLinks(
  orgId?: string | null,
  options?: { active?: CompetitionRelatedId; include?: CompetitionRelatedId[] },
): CompetitionRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return COMPETITION_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if ("tab" in link && link.tab) {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return {
      id: link.id,
      label: link.label,
      href: withOrg(link.href, orgId),
    };
  });
}

export type StrategySetupContext = {
  orgId?: string | null;
  eventKey?: string | null;
  tbaConfigured?: boolean;
  hasMetrics?: boolean;
};

export type StrategyNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Readable next actions when Strategy / pick surfaces lack TBA, event, or metrics.
 * Never invents DEMO win rates or EPA — only points at real setup paths.
 */
export function strategySetupNextActions(ctx: StrategySetupContext): StrategyNextAction[] {
  const orgId = ctx.orgId ?? null;
  const actions: StrategyNextAction[] = [];

  if (!orgId) {
    actions.push({
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization before loading event strategy.",
      href: "/workspace",
      primary: true,
    });
    return actions;
  }

  if (!ctx.eventKey) {
    actions.push({
      id: "event",
      label: "Set active event",
      detail: "Event Day Command picks the TBA event schedule Strategy and picks use.",
      href: withOrg("/command", orgId),
      primary: true,
    });
  }

  if (ctx.tbaConfigured === false) {
    actions.push({
      id: "tba",
      label: "Configure TBA sync",
      detail: "Set TBA_AUTH_KEY or save a TBA credential under Team → Data. No fabricated schedule while sync is missing.",
      href: withOrg("/team/data", orgId),
      primary: !ctx.eventKey ? false : true,
    });
  }

  if (ctx.hasMetrics === false) {
    actions.push({
      id: "metrics",
      label: "Sync reference metrics",
      detail: "Pull TBA/Statbotics rows into Neon — Strategy never invents EPA or win probability.",
      href: withOrg("/team/data", orgId),
      primary: Boolean(ctx.eventKey) && ctx.tbaConfigured !== false,
    });
  }

  // Always offer scout depth / form / checklist when an org exists — real data paths only.
  actions.push(
    {
      id: "scouting",
      label: "Add scout notes",
      detail: "Match and pit entries deepen pick explainability once synced.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "forms",
      label: "Publish form schema",
      detail: "Custom fields flow into strategy tools after publish.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "checklist",
      label: "Match checklist",
      detail: "Pre-match pit checklist for the same event context.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "coverage",
      label: "Scout coverage live",
      detail: "See which matches and teams still need coverage before picks.",
      href: withOrg("/scout-coverage-live", orgId, { eventKey: ctx.eventKey }),
    },
  );

  return actions;
}

/** Compact coverage + explainability links for live Strategy / pick desks. */
export function strategyCoverageLinks(
  orgId: string,
  options?: { eventKey?: string | null },
): CompetitionRelatedLink[] {
  return competitionRelatedLinks(orgId, {
    include: ["scouting", "forms", "match-checklist", "coverage", "pick-clock", "chemistry", "draft"],
  }).map((link) => {
    if (link.id === "coverage" && options?.eventKey) {
      return { ...link, href: withOrg("/scout-coverage-live", orgId, { eventKey: options.eventKey }) };
    }
    return link;
  });
}

/** Setup copy for pick-clock / draft / chemistry when the surface cannot run yet. */
export function pickSurfaceSetupMessage(ctx: StrategySetupContext): string {
  if (!ctx.orgId) return "Select a team workspace before opening this Competition tool.";
  if (!ctx.eventKey) {
    return "Select an active event on Event Day Command. No demo alliances or invented pick rankings.";
  }
  if (ctx.tbaConfigured === false && ctx.hasMetrics === false) {
    return "TBA is not configured and no event metrics are cached. Sync under Team → Data — Vantage will not invent EPA.";
  }
  if (ctx.hasMetrics === false) {
    return "No team_event_metrics for this event yet. Sync TBA/Statbotics under Team → Data before ranking picks.";
  }
  return "Setup required before this surface can run on real event data.";
}
