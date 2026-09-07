/**
 * Is this string safe to hand Postgres as a `uuid`?
 *
 * Every parameter cast to `$1::uuid` has to be checked first: Postgres rejects
 * anything else with `invalid input syntax for type uuid: "…"`, and route
 * handlers that echo `error.message` then show the driver's complaint to the
 * reader instead of saying what was actually wrong.
 *
 * Deliberately shape-only — it accepts any hex in the version and variant
 * nibbles. A few modules (`lib/logistics.ts`, `lib/visit-invites.ts`) use
 * RFC-version-strict patterns instead because they validate ids the product
 * generated itself; those are a different question and stay where they are.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` can be cast to uuid without the driver throwing. */
export function isUuidShape(value: unknown): value is string {
  return typeof value === "string" && UUID_SHAPE.test(value);
}

/**
 * The value when it is uuid-shaped, otherwise null — for optional filters where
 * "absent" and "malformed" should behave the same way rather than error.
 */
export function uuidShapeOrNull(value: unknown): string | null {
  return isUuidShape(value) ? value : null;
}
