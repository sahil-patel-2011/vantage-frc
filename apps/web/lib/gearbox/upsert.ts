import { parseGearboxAction, type GearboxAction, type GearboxInput } from "../gearbox";

export type GearboxIdentity = {
  orgId: string;
  seasonYear: number;
  name: string;
  subsystem: string;
};

export type ExistingGearboxRef = GearboxIdentity & { id: string };

export type GearboxWrite =
  | { kind: "insert" }
  | { kind: "update"; id: string; reason: "id" | "identity" };

export type GearboxWriteAction =
  | ({ action: "save_gearbox"; orgId: string; seasonYear: number; id?: string } & GearboxInput)
  | { action: "delete_gearbox"; orgId: string; id: string };

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

/** Stable key for "this is the same saved gearbox" — org + season + name + subsystem. */
export function gearboxIdentityKey(row: GearboxIdentity): string {
  return [row.orgId, String(row.seasonYear), normalizePart(row.name), normalizePart(row.subsystem)].join("\0");
}

/**
 * Decide insert vs in-place update without touching the database.
 *
 * An explicit `id` that belongs to the same org wins (rename stays on the same row).
 * Otherwise the natural key (org, season, name, subsystem) updates the existing row
 * so saving SDS MK4i L2 a second time does not duplicate-insert.
 */
export function resolveGearboxWrite(
  incoming: GearboxIdentity & { id?: string | null },
  existing: ExistingGearboxRef[],
): GearboxWrite {
  const incomingId = incoming.id?.trim() || null;
  if (incomingId) {
    const byId = existing.find((row) => row.id === incomingId && row.orgId === incoming.orgId);
    if (byId) return { kind: "update", id: byId.id, reason: "id" };
  }

  const key = gearboxIdentityKey(incoming);
  const byIdentity = existing.find((row) => gearboxIdentityKey(row) === key);
  if (byIdentity) return { kind: "update", id: byIdentity.id, reason: "identity" };
  return { kind: "insert" };
}

export function parseGearboxWrite(raw: unknown): GearboxWriteAction {
  const action = parseGearboxAction(raw) as GearboxAction;
  if (action.action !== "save_gearbox") return action;
  if (!raw || typeof raw !== "object") return action;
  const id = (raw as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) return action;
  return { ...action, id: id.trim() };
}

/** Unique index from 0503_gearbox_identity_unique.sql. Postgres 23505 names this. */
export const GEARBOX_IDENTITY_UNIQUE_INDEX = "gearboxes_identity_uidx";

/**
 * True when INSERT lost a race on (org, season, lower(name), lower(subsystem)).
 * Other unique violations (primary key, unrelated indexes) stay errors.
 */
export function isGearboxIdentityUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (err.code !== "23505") return false;
  const constraint = typeof err.constraint === "string" ? err.constraint : "";
  const message = typeof err.message === "string" ? err.message : "";
  return constraint === GEARBOX_IDENTITY_UNIQUE_INDEX || message.includes(GEARBOX_IDENTITY_UNIQUE_INDEX);
}

/**
 * After the identity unique index rejects an INSERT, treat the save as an
 * update of the row that won the race. `existing` must be reloaded first.
 */
export function resolveGearboxWriteAfterUniqueViolation(
  incoming: GearboxIdentity & { id?: string | null },
  existing: ExistingGearboxRef[],
): GearboxWrite {
  const write = resolveGearboxWrite(incoming, existing);
  if (write.kind === "update") return write;
  throw new Error("This gearbox name is already saved for this subsystem");
}

/**
 * If `error` is the identity unique violation, resolve as update; otherwise null
 * so the caller can rethrow.
 */
export function gearboxWriteFromUniqueViolation(
  error: unknown,
  incoming: GearboxIdentity & { id?: string | null },
  existing: ExistingGearboxRef[],
): GearboxWrite | null {
  if (!isGearboxIdentityUniqueViolation(error)) return null;
  return resolveGearboxWriteAfterUniqueViolation(incoming, existing);
}
