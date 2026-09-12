import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { BuildRelatedId } from "../build/build-related";
import type { TeamHubRelatedId } from "../team/team-related";
import type { BatteryStatus, HealthStatus } from "../battery";

/** Focused Soft-UI Team strip when Batteries is open (never DEMO placeholders). */
export const BATTERIES_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "fmea",
  "practice",
  "messages",
  "knowledge",
];

/** Focused Soft-UI Build strip when Batteries is open. */
export const BATTERIES_BUILD_RELATED_INCLUDE: BuildRelatedId[] = [
  "fmea",
  "kickoff",
  "competition",
];

export type BatteryPackSnap = {
  id: string;
  label: string;
  status: BatteryStatus;
  cycleCount: number;
  lastInternalResistanceMohm: number | null;
  lastRestingVoltage: number | null;
  lastChargedAt: string | null;
  health: { status: HealthStatus; score: number; reasons: string[] };
  readiness: { ready: boolean; reasons: string[] };
};

export type BatteryNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

function withOrg(path: string, orgId?: string | null): string {
  return withOrgHref(path, orgId);
}

/** True when the pack has at least one real IR or voltage log — never invent metrics. */
export function packHasMeasurement(pack: Pick<BatteryPackSnap, "lastInternalResistanceMohm" | "lastRestingVoltage">): boolean {
  return pack.lastInternalResistanceMohm != null || pack.lastRestingVoltage != null;
}

/** True when match/practice cycles were actually logged (0 is not a fabricable counter). */
export function packHasCycles(pack: Pick<BatteryPackSnap, "cycleCount">): boolean {
  return pack.cycleCount > 0;
}

/**
 * Readable Soft-UI next actions for battery pack ops.
 * Points at real logging / pit / FMEA paths — never DEMO IR or cycle numbers.
 */
export function batteryNextActions(input: {
  orgId?: string | null;
  packs: BatteryPackSnap[];
  logCount: number;
  nextRotationLabel?: string | null;
}): BatteryNextAction[] {
  const orgId = input.orgId ?? null;
  const packs = input.packs;
  const active = packs.filter((p) => p.status === "active");
  const actions: BatteryNextAction[] = [];

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before tracking packs.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  if (packs.length === 0) {
    actions.push({
      id: "add-pack",
      label: "Add your first pack",
      detail: "Labels start empty — IR, voltage, and cycles appear only after you log them.",
      href: hubHref("/team", "batteries", orgId),
      primary: true,
    });
    actions.push({
      id: "pit",
      label: "Open Pit command",
      detail: "Same readiness rules as Batteries — log measurements from the pit.",
      href: withOrg("/pit", orgId),
    });
    return actions;
  }

  const unmeasured = active.filter((p) => !packHasMeasurement(p));
  if (unmeasured.length > 0) {
    const sample = unmeasured[0]!;
    actions.push({
      id: "log-ir",
      label: `Log a resistance test${unmeasured.length > 1 ? ` (${unmeasured.length} packs)` : ""}`,
      detail: `${sample.label} has no IR or voltage reading yet. Health stays blank until you measure.`,
      href: hubHref("/team", "batteries", orgId),
      primary: true,
    });
  }

  const needAttention = active.filter((p) => !p.readiness.ready || p.health.status !== "good");
  if (needAttention.length > 0 && unmeasured.length === 0) {
    const sample = needAttention[0]!;
    actions.push({
      id: "attention",
      label: `Review ${sample.label}`,
      detail:
        sample.health.reasons[0] ??
        sample.readiness.reasons[0] ??
        "Pack is not competition-ready from logged readings.",
      href: hubHref("/team", "batteries", orgId),
      primary: true,
    });
  }

  const neverCharged = active.filter((p) => !p.lastChargedAt);
  if (neverCharged.length > 0 && actions.length < 3) {
    actions.push({
      id: "charge",
      label: "Mark a pack charged",
      detail: `${neverCharged[0]!.label} has no charge log yet — charge events come from real pit work.`,
      href: hubHref("/team", "batteries", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.nextRotationLabel && actions.length < 3) {
    actions.push({
      id: "rotation",
      label: `Next pack: ${input.nextRotationLabel}`,
      detail: "Rotation ranks only active packs with real health signals.",
      href: withOrg("/battery-rotation", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.logCount === 0 && packs.length > 0 && actions.every((a) => a.id !== "log-ir")) {
    actions.unshift({
      id: "first-log",
      label: "Log the first event",
      detail: "Charge, match, practice, or resistance tests — the activity feed stays empty until then.",
      href: hubHref("/team", "batteries", orgId),
      primary: true,
    });
  }

  actions.push({
    id: "pit",
    label: "Pit Command",
    detail: "Event-day battery status uses the same pack + log evidence.",
    href: withOrg("/pit", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "fmea",
    label: "Battery failures in Failure log",
    detail: "Retire flows can open a failure mode — link retired packs to real root causes.",
    href: hubHref("/team", "fmea", orgId),
  });

  actions.push({
    id: "forecast",
    label: "Health forecast",
    detail: "End-of-life forecasts use only logged IR and cycle history.",
    href: withOrg("/battery-health-forecast", orgId),
  });

  return actions.slice(0, 5);
}

/** Pack list subtitle from real logs only — omits missing IR / zero cycles. */
export function formatPackEvidence(pack: {
  cycleCount: number;
  nominalAh: number | null;
  lastInternalResistanceMohm: number | null;
  lastRestingVoltage: number | null;
  ageMonths: number | null;
  lastChargedAt: string | null;
  formatWhen: (iso: string | null) => string;
}): string {
  const parts: string[] = [];
  if (pack.cycleCount > 0) parts.push(`${pack.cycleCount} cycles logged`);
  if (pack.nominalAh != null) parts.push(`${pack.nominalAh} Ah`);
  if (pack.lastInternalResistanceMohm != null) parts.push(`${pack.lastInternalResistanceMohm} mΩ`);
  if (pack.lastRestingVoltage != null) parts.push(`${pack.lastRestingVoltage} V`);
  if (pack.ageMonths != null) parts.push(`${pack.ageMonths} mo`);
  if (pack.lastChargedAt) parts.push(`charged ${pack.formatWhen(pack.lastChargedAt)}`);
  if (parts.length === 0) return "No IR, voltage, or cycle logs yet";
  return parts.join(" · ");
}
