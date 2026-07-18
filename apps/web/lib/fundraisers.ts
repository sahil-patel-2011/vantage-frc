// Team-run fundraiser events (car wash, bottle drive, restaurant night, product
// sale). Distinct from the corporate-sponsor CRM: these are community events the
// team throws to raise money. Proceeds post to the finance ledger as income via
// the existing 'fundraiser' transaction source.

export const FUNDRAISER_TYPES = [
  "car_wash",
  "bottle_drive",
  "restaurant_night",
  "bake_sale",
  "product_sale",
  "crowdfunding",
  "event_ticket",
  "other",
] as const;
export type FundraiserType = (typeof FUNDRAISER_TYPES)[number];

export const FUNDRAISER_TYPE_LABEL: Record<FundraiserType, string> = {
  car_wash: "Car wash",
  bottle_drive: "Bottle / can drive",
  restaurant_night: "Restaurant night",
  bake_sale: "Bake sale",
  product_sale: "Product sale",
  crowdfunding: "Crowdfunding",
  event_ticket: "Ticketed event",
  other: "Other",
};

export const FUNDRAISER_STATUSES = ["planned", "active", "completed", "cancelled"] as const;
export type FundraiserStatus = (typeof FUNDRAISER_STATUSES)[number];

export function attainmentPct(proceedsUsd: number, goalUsd: number | null): number | null {
  if (goalUsd == null || goalUsd <= 0) return null;
  return Math.round((proceedsUsd / goalUsd) * 100);
}

export function summarizeFundraisers(events: { status: FundraiserStatus; goalUsd: number | null; proceedsUsd: number }[]) {
  const counted = events.filter((e) => e.status !== "cancelled");
  const totalRaised = round2(counted.reduce((sum, e) => sum + e.proceedsUsd, 0));
  const totalGoal = round2(counted.reduce((sum, e) => sum + (e.goalUsd ?? 0), 0));
  return {
    totalRaised,
    totalGoal,
    attainment: attainmentPct(totalRaised, totalGoal || null),
    planned: events.filter((e) => e.status === "planned").length,
    active: events.filter((e) => e.status === "active").length,
    completed: events.filter((e) => e.status === "completed").length,
  };
}

export type FundraiserInput = { name: string; type: FundraiserType; eventDate: string; goalUsd: number | null; location: string; notes: string };

export function validateFundraiser(raw: Record<string, unknown>): { ok: true; value: FundraiserInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const type = String(raw.type ?? "");
  if (!FUNDRAISER_TYPES.includes(type as FundraiserType)) return { ok: false, error: "Invalid fundraiser type" };
  const eventDate = typeof raw.eventDate === "string" ? raw.eventDate : "";
  if (!eventDate || Number.isNaN(new Date(eventDate).getTime())) return { ok: false, error: "A valid date is required" };
  let goalUsd: number | null = null;
  if (raw.goalUsd !== undefined && raw.goalUsd !== null && raw.goalUsd !== "") {
    goalUsd = Number(raw.goalUsd);
    if (!Number.isFinite(goalUsd) || goalUsd < 0) return { ok: false, error: "Goal must be zero or greater" };
  }
  return {
    ok: true,
    value: {
      name,
      type: type as FundraiserType,
      eventDate,
      goalUsd,
      location: typeof raw.location === "string" ? raw.location.trim() : "",
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

// ---- request validation --------------------------------------------------

export type FundraiserAction =
  | { action: "create_event"; orgId: string; seasonYear: number; name: string; type: FundraiserType; eventDate: string; goalUsd: number | null; location: string; notes: string }
  | { action: "set_status"; orgId: string; id: string; status: FundraiserStatus }
  | { action: "record_proceeds"; orgId: string; id: string; amountUsd: number; note: string }
  | { action: "delete_event"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseFundraiserAction(raw: unknown): FundraiserAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_event": {
      const validated = validateFundraiser(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "set_status": {
      const status = reqStr(body.status, "status");
      if (!FUNDRAISER_STATUSES.includes(status as FundraiserStatus)) throw new Error("Invalid status");
      return { action, orgId, id: reqStr(body.id, "id"), status: status as FundraiserStatus };
    }
    case "record_proceeds": {
      const amountUsd = Number(body.amountUsd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Proceeds amount must be greater than zero");
      return { action, orgId, id: reqStr(body.id, "id"), amountUsd, note: typeof body.note === "string" ? body.note.trim() : "" };
    }
    case "delete_event":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported fundraiser action");
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
