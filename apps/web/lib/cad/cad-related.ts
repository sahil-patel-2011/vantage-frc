import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { BuildRelatedId } from "../build/build-related";
import type { CompetitionRelatedId } from "../strategy/competition-related";

/** Focused Soft-UI Build strip when CAD is open (never DEMO placeholders). */
export const CAD_BUILD_RELATED_INCLUDE: BuildRelatedId[] = ["kickoff", "fmea"];

/** Focused Soft-UI Competition strip for Strategy cross-links from CAD. */
export const CAD_COMPETITION_RELATED_INCLUDE: CompetitionRelatedId[] = ["strategy"];

export type CadHubRelatedId = "cad-vault" | "cad-learn" | "assembly-manual";

export type CadHubRelatedLink = {
  id: CadHubRelatedId;
  label: string;
  href: string;
};

/** Student CAD tab strip — vault / Learn CAD / assembly manual, not Analyze. */
export const CAD_HUB_RELATED_INCLUDE: CadHubRelatedId[] = [
  "cad-vault",
  "cad-learn",
  "assembly-manual",
];

const CAD_HUB_RELATED_LINKS: Array<{ id: CadHubRelatedId; label: string; path: string }> = [
  { id: "cad-vault", label: "CAD vault", path: "/cad-vault" },
  { id: "cad-learn", label: "Learn CAD", path: "/cad-learn" },
  { id: "assembly-manual", label: "Assembly manual", path: "/assembly-manual" },
];

export function cadHubRelatedLinks(
  orgId?: string | null,
  options?: { active?: CadHubRelatedId; include?: CadHubRelatedId[] },
): CadHubRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CAD_HUB_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}

export type CadNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CadTopologySummary = {
  bodies?: unknown;
  features?: unknown;
  validation?: unknown;
  [key: string]: unknown;
};

/** True when topology summary is labeled mock / demo — never present as live geometry metrics. */
export function isMockTopologySummary(topology: unknown): boolean {
  if (!topology || typeof topology !== "object") return false;
  const validation = (topology as CadTopologySummary).validation;
  if (typeof validation === "string" && /mock|demo/i.test(validation)) return true;
  return false;
}

/**
 * Honest Soft-UI topology line from a real checkpoint.
 * Omits DEMO/mock validation metrics; fingerprint shown only when present.
 */
export function formatTopologyEvidence(input: {
  topology: unknown;
  humanEditDetected?: boolean;
  platform?: string;
}): string {
  if (input.humanEditDetected) return "Human edit detected · review before resume";

  const platform = input.platform ?? "";
  if (platform === "mock" || isMockTopologySummary(input.topology)) {
    return "Demo / mock checkpoint · not live CAD geometry";
  }

  const topo = input.topology && typeof input.topology === "object" ? (input.topology as CadTopologySummary) : null;
  if (!topo) return "Topology verified";

  const parts: string[] = ["Topology verified"];
  const bodies = typeof topo.bodies === "number" ? topo.bodies : null;
  const features = typeof topo.features === "number" ? topo.features : null;
  if (bodies != null && bodies > 0) parts.push(`${bodies} bod${bodies === 1 ? "y" : "ies"}`);
  if (features != null && features > 0) parts.push(`${features} feature${features === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Readable Soft-UI next actions for the CAD workbench.
 * Points at Kickoff / FMEA / Strategy and real connector setup — never DEMO geometry metrics.
 */
export function cadNextActions(input: {
  orgId?: string | null;
  jobCount: number;
  onshapeConfigured: boolean;
  onshapeConnected: boolean;
  fusionRelayOnline: boolean;
}): CadNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before starting engineering briefs.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: CadNextAction[] = [];

  if (input.jobCount === 0) {
    actions.push({
      id: "first-brief",
      label: "Create your first engineering brief",
      detail: "Briefs stay empty until you cite intent — geometry checkpoints appear only after approved ops.",
      href: hubHref("/build", "cad", orgId),
      primary: true,
    });
  }

  actions.push({
    id: "ai-keys",
    label: "Connect an AI provider for CAD plans",
    detail: "AI plan from brief is metered. Without a key, use the starter plan (no model) or add keys under Team → AI API keys.",
    href: withOrgHref("/team/ai-keys", orgId),
  });

  if (!input.onshapeConfigured) {
    actions.push({
      id: "onshape-oauth",
      label: "Configure Onshape OAuth",
      detail: "Setup required — an admin must set ONSHAPE_OAUTH_* on the server before hosted CAD runs.",
      href: withOrgHref("/cad/connections", orgId),
      primary: actions.length === 0,
    });
  } else if (!input.onshapeConnected) {
    actions.push({
      id: "onshape-connect",
      label: "Connect Onshape OAuth",
      detail: "OAuth client is configured — connect your account in Connections before Run Onshape.",
      href: withOrgHref("/cad/connections", orgId),
      primary: actions.length === 0,
    });
  }

  if (!input.fusionRelayOnline) {
    actions.push({
      id: "fusion-relay",
      label: "Pair Fusion desktop relay",
      detail: "Fusion stays local — Vantage never hosts Autodesk. Pair vantage-cad on your machine to execute.",
      href: withOrgHref("/cad/setup", orgId),
      primary: actions.length === 0,
    });
  }

  actions.push({
    id: "kickoff",
    label: "Ground in Kickoff priorities",
    detail: "Season priorities and rule citations can shape engineering briefs.",
    href: hubHref("/build", "kickoff", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "fmea",
    label: "Open FMEA risks",
    detail: "Repeat failures become design constraints — empty log means empty reliability context.",
    href: hubHref("/build", "fmea", orgId),
  });

  actions.push({
    id: "strategy",
    label: "Open Strategy",
    detail: "Link a match plan so confirmed CAD requirements flow back into Competition Strategy.",
    href: hubHref("/competition", "strategy", orgId),
  });

  return actions.slice(0, 6);
}
