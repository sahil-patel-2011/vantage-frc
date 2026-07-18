// Robot bring-up / commissioning checklist. The "first power-on" procedure a team
// runs on a newly-assembled robot before it ever drives — distinct from the
// competition inspection checklist (which is event-readiness). Seeded from a
// standard template covering mechanical, electrical, software, and validation.

export const BRINGUP_PHASES = ["mechanical", "electrical", "software", "validation"] as const;
export type BringupPhase = (typeof BRINGUP_PHASES)[number];

export const BRINGUP_PHASE_LABEL: Record<BringupPhase, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  software: "Software",
  validation: "Validation",
};

export const BRINGUP_RESULTS = ["pending", "pass", "fail", "na"] as const;
export type BringupResult = (typeof BRINGUP_RESULTS)[number];

export const BRINGUP_TEMPLATE: { phase: BringupPhase; label: string }[] = [
  { phase: "mechanical", label: "All fasteners installed and torqued" },
  { phase: "mechanical", label: "No mechanism interference through full range of motion" },
  { phase: "mechanical", label: "Belts / chains tensioned; no skipping" },
  { phase: "mechanical", label: "Bumpers fit and mount correctly" },
  { phase: "electrical", label: "Battery secured; main breaker functional" },
  { phase: "electrical", label: "Branch breakers correctly sized for each motor" },
  { phase: "electrical", label: "CAN chain continuous and terminated" },
  { phase: "electrical", label: "Robot Signal Light (RSL) blinks on enable" },
  { phase: "electrical", label: "No brownout on first power-up" },
  { phase: "software", label: "Robot code deploys and robot enables" },
  { phase: "software", label: "Every motor responds to its command" },
  { phase: "software", label: "Encoders count in the correct direction" },
  { phase: "software", label: "Limit switches / sensors read correctly" },
  { phase: "software", label: "Gyro zeroes and reports heading" },
  { phase: "validation", label: "Robot drives straight; no drift" },
  { phase: "validation", label: "Each mechanism moves through full range under control" },
  { phase: "validation", label: "Current draw nominal under load (no unexpected spikes)" },
  { phase: "validation", label: "Emergency stop / disable works" },
];

export function computeProgress(items: { result: BringupResult }[]) {
  const total = items.length;
  const done = items.filter((i) => i.result === "pass" || i.result === "na").length;
  const failed = items.filter((i) => i.result === "fail").length;
  return {
    total,
    done,
    failed,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    ready: total > 0 && done === total && failed === 0,
  };
}

// ---- request validation --------------------------------------------------

export type BringupAction =
  | { action: "seed_template"; orgId: string; seasonYear: number }
  | { action: "add_item"; orgId: string; seasonYear: number; phase: BringupPhase; label: string }
  | { action: "set_result"; orgId: string; id: string; result: BringupResult; note: string }
  | { action: "delete_item"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseBringupAction(raw: unknown): BringupAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "seed_template": {
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action: "seed_template", orgId, seasonYear };
    }
    case "add_item": {
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      const phase = String(body.phase ?? "");
      if (!BRINGUP_PHASES.includes(phase as BringupPhase)) throw new Error("Invalid phase");
      return { action: "add_item", orgId, seasonYear, phase: phase as BringupPhase, label: reqStr(body.label, "label") };
    }
    case "set_result": {
      const result = reqStr(body.result, "result");
      if (!BRINGUP_RESULTS.includes(result as BringupResult)) throw new Error("Invalid result");
      return { action: "set_result", orgId, id: reqStr(body.id, "id"), result: result as BringupResult, note: typeof body.note === "string" ? body.note.trim() : "" };
    }
    case "delete_item":
      return { action: "delete_item", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported bring-up action");
  }
}
