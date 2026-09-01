/**
 * Composer stores some CAD ids as a string or string[].
 * `String(["a","b"])` becomes `"a,b"` — take the first non-empty entry instead.
 * Never invents DEMO ids; a DEMO token is refused.
 */
const DEMO_ID = /demo/i;

export function firstPlannedId(value: unknown): string {
  const candidates = Array.isArray(value) ? value : [value];
  for (const item of candidates) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id) continue;
    if (DEMO_ID.test(id)) {
      throw new Error("Refusing DEMO id. Pass a real Onshape id from a prior create or list.");
    }
    return id;
  }
  return "";
}
