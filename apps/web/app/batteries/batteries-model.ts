import type { BatteryStatus, CartSlot, HealthStatus } from "../../lib/battery";

export type Pack = {
  id: string;
  label: string;
  brand: string | null;
  nominalAh: number | null;
  purchaseDate: string | null;
  status: BatteryStatus;
  assignment: string;
  notes: string;
  cycleCount: number;
  ageMonths: number | null;
  lastInternalResistanceMohm: number | null;
  lastRestingVoltage: number | null;
  lastUsedAt: string | null;
  lastChargedAt: string | null;
  health: { status: HealthStatus; score: number | null; reasons: string[] };
  readiness: { ready: boolean; reasons: string[] };
  cartSlot: CartSlot;
};

export type Log = {
  id: string;
  batteryId: string;
  batteryLabel: string;
  kind: string;
  restingVoltage: number | null;
  internalResistanceMohm: number | null;
  matchKey: string | null;
  note: string;
  byName: string | null;
  createdAt: string;
};

export type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; orgName?: string | null; teamNumber?: number | null; role: string };
      packs: Pack[];
      logs: Log[];
      rotation: string[];
      summary: {
        active: number;
        competitionReady: number;
        needAttention: number;
        retired: number;
        cartReady: number;
        cartCooling: number;
      };
    };

export type ReadyView = Extract<View, { status: "ready" }>;
export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type RunFn = (body: ActionBody, key: string) => Promise<void>;
export type HubEmbed = "team" | "build";

export type PackForm = {
  label: string;
  brand: string;
  nominalAh: string;
  purchaseDate: string;
  assignment: string;
  initialResistanceMohm: string;
  initialVoltage: string;
};

export type LogForm = {
  batteryId: string;
  kind: string;
  restingVoltage: string;
  internalResistanceMohm: string;
  matchKey: string;
  note: string;
};

export const EMPTY_PACK_FORM: PackForm = {
  label: "",
  brand: "",
  nominalAh: "18",
  purchaseDate: "",
  assignment: "",
  initialResistanceMohm: "",
  initialVoltage: "",
};

export const EMPTY_LOG_FORM: LogForm = {
  batteryId: "",
  kind: "resistance_test",
  restingVoltage: "",
  internalResistanceMohm: "",
  matchKey: "",
  note: "",
};

export function healthStatusLabel(status: HealthStatus): string {
  switch (status) {
    case "good":
      return "Good";
    case "aging":
      return "Aging";
    case "retire":
      return "Retire";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

/**
 * The health badge for one pack.
 *
 * `status` alone is not safe to render: `batteryHealth` only ever *escalates*
 * away from "good", so a pack with no internal-resistance or resting-voltage
 * log comes back "good" simply because nothing contradicted it. On competition
 * day that badge said "Good" about a pack the team had never tested. `score`
 * is the honest signal — it is null exactly when there is no measurement — so
 * the badge reads off the score and says Unknown rather than picking a grade
 * out of nothing.
 */
export function healthBadge(health: Pack["health"]): { tone: "unmeasured" | HealthStatus; label: string } {
  if (health.score == null) return { tone: "unmeasured", label: "Unknown" };
  return { tone: health.status, label: healthStatusLabel(health.status) };
}

export function logKindLabel(kind: string): string {
  switch (kind) {
    case "charge":
      return "Charged";
    case "storage_charge":
      return "Storage charge";
    case "match":
      return "Match";
    case "practice":
      return "Practice";
    case "resistance_test":
      return "Resistance test";
    case "note":
      return "Note";
    case "retire":
      return "Retired";
    case "return_to_service":
      return "Back in service";
    default:
      return kind;
  }
}

export function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function batteryCrumbs(embed: HubEmbed | null): string {
  return embed === "build" ? "Build / Batteries" : "Team / Batteries";
}

export function batteryRunOkMessage(action: string): string {
  if (action === "create_pack") return "Battery added.";
  if (action === "log_event") return "Logged.";
  if (action === "assign_pack") return "Assignment updated.";
  return "Updated.";
}

export function rotationPacksFrom(view: ReadyView): Pack[] {
  return view.rotation
    .map((id) => view.packs.find((pack) => pack.id === id))
    .filter((pack): pack is Pack => Boolean(pack));
}
