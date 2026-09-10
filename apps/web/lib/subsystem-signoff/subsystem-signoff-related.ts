import type { BuildRelatedId } from "../build/build-related";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { SubsystemSignoffTier } from "./types";

/** Focused Soft-UI Build strip when Subsystem Sign-off is open (never DEMO placeholders). */
export const SIGNOFF_BUILD_RELATED_INCLUDE: BuildRelatedId[] = [
  "fmea",
  "cad",
  "prototype",
];

/**
 * Soft-UI related surfaces for subsystem sign-off.
 * Gate reviews sit next to FMEA failure modes, CAD geometry, and the task board.
 */
export const SIGNOFF_RELATED_LINKS = [
  { id: "fmea", label: "FMEA", kind: "build" as const, tab: "fmea" },
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "tasks", label: "Tasks", kind: "path" as const, path: "/tasks" },
  { id: "subsystems", label: "Subsystem specs", kind: "path" as const, path: "/subsystems" },
  { id: "prototype", label: "Prototypes", kind: "build" as const, tab: "prototype" },
] as const;

export type SignoffRelatedId = (typeof SIGNOFF_RELATED_LINKS)[number]["id"];

export type SignoffRelatedLink = {
  id: SignoffRelatedId;
  label: string;
  href: string;
};

/** Cross-links for Subsystem Sign-off Soft-UI (never DEMO readiness %). */
export function signoffRelatedLinks(
  orgId?: string | null,
  options?: { active?: SignoffRelatedId; include?: SignoffRelatedId[] },
): SignoffRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SIGNOFF_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type SignoffNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for subsystem gate reviews.
 * Points at real sign-offs / FMEA / CAD / Tasks — never DEMO readiness %.
 */
export function signoffNextActions(input: {
  orgId?: string | null;
  subsystemCount: number;
  startedCount: number;
  signedOffCount: number;
  blockedCount: number;
  pendingGates: number;
  topTitle?: string | null;
}): SignoffNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before tracking subsystem gate sign-offs.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const signoffHref = withOrgHref("/subsystem-signoff", orgId);
  const actions: SignoffNextAction[] = [];

  if (input.subsystemCount === 0) {
    actions.push({
      id: "add-first",
      label: "Add the first robot subsystem",
      detail: "Readiness stays blank until you list drivetrain, intake, scoring, and friends — nothing is pre-filled.",
      href: signoffHref,
      primary: true,
    });
    actions.push({
      id: "fmea",
      label: "Scan open FMEA modes",
      detail: "Weak subsystems already in the failure log often need the earliest design / field-test gates.",
      href: hubHref("/build", "fmea", orgId),
    });
    actions.push({
      id: "cad",
      label: "Open CAD briefs",
      detail: "Design-review gates usually wait on real geometry.",
      href: hubHref("/build", "cad", orgId),
    });
    actions.push({
      id: "tasks",
      label: "Assign build Tasks",
      detail: "Break fabrication and wiring into assignable work on the build-season board.",
      href: withOrgHref("/tasks", orgId),
    });
    return actions;
  }

  if (input.blockedCount > 0) {
    const sample = input.topTitle?.trim() || "a blocked subsystem";
    actions.push({
      id: "blocked",
      label: `Unblock ${input.blockedCount} subsystem${input.blockedCount === 1 ? "" : "s"}`,
      detail: `${sample} is marked blocked — resolve the hold before recording more gate approvals.`,
      href: signoffHref,
      primary: true,
    });
  } else if (input.startedCount === 0) {
    actions.push({
      id: "first-gate",
      label: "Record the first design review",
      detail: `${input.subsystemCount} subsystem${input.subsystemCount === 1 ? "" : "s"} on the board — readiness % appears only after a real approve/reject.`,
      href: signoffHref,
      primary: true,
    });
  } else if (input.pendingGates > 0) {
    const sample = input.topTitle?.trim();
    actions.push({
      id: "pending-gates",
      label: `Clear ${input.pendingGates} pending gate${input.pendingGates === 1 ? "" : "s"}`,
      detail: sample
        ? `${sample} still needs gate decisions — % is from recorded approvals only.`
        : "Approve or reject remaining gates from real reviews.",
      href: signoffHref,
      primary: true,
    });
  } else if (input.signedOffCount < input.subsystemCount) {
    actions.push({
      id: "mark-signed",
      label: "Mark fully cleared subsystems signed off",
      detail: `${input.signedOffCount}/${input.subsystemCount} fully gate-approved — update status when the trail is complete.`,
      href: signoffHref,
      primary: true,
    });
  }

  actions.push({
    id: "fmea",
    label: "Log failures in FMEA",
    detail: "Rejected gates and field issues belong in O×S×D — sign-off tracks the review trail.",
    href: hubHref("/build", "fmea", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "cad",
    label: "Confirm geometry in CAD",
    detail: "Design and fabrication gates should match the current brief, not tribal memory.",
    href: hubHref("/build", "cad", orgId),
  });

  if (actions.length < 5) {
    actions.push({
      id: "tasks",
      label: "Drive remaining work from Tasks",
      detail: "Turn open gates into assignable build-season tasks with owners and due dates.",
      href: withOrgHref("/tasks", orgId),
    });
  }

  return actions.slice(0, 5);
}

/**
 * Competition readiness % — blank until at least one subsystem exists and a gate decision is recorded.
 * Never show a DEMO 0% scorecard on an empty board.
 */
export function formatSignoffReadinessDisplay(
  score: number,
  input: { subsystemCount: number; startedCount: number },
): string {
  if (input.subsystemCount <= 0 || input.startedCount <= 0) return "—";
  return `${Math.round(score * 100)}%`;
}

/** Gate completion fraction for one subsystem — blank until a decision exists. */
export function formatSubsystemCompletionDisplay(
  completion: number,
  approvedGates: number,
  rejectedGates: number,
): string {
  if (approvedGates + rejectedGates <= 0) return "—";
  return `${Math.round(completion * 100)}%`;
}

export function signoffTierTone(tier: SubsystemSignoffTier): "good" | "setup" | "demo" {
  if (tier === "ready") return "good";
  if (tier === "in_progress") return "setup";
  return "demo";
}

export function shouldShowSignoffSummaryTiles(subsystemCount: number): boolean {
  return subsystemCount > 0;
}
