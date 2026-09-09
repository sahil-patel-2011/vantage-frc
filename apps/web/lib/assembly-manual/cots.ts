import type { PoolClient } from "@neondatabase/serverless";

/**
 * COTS part lookup — deliberately optional.
 *
 * A separate piece of work is adding a reference catalog of commercial off-the-
 * shelf FRC hardware (REV, WCP, AndyMark, VEXpro, McMaster…). When it lands, a
 * hardware line in the manual can read "REV-21-1651 · 10-32 x 1.00 socket head
 * cap screw" instead of whatever the designer happened to call the part in CAD.
 *
 * Until then — and on any deployment where the catalog table has not been
 * migrated — every lookup returns null and the manual falls back to the CAD's
 * own part name plus the dimensions it measured. That fallback is not a
 * degraded mode we apologise for: the part name in the team's own CAD is a real
 * fact about their design, and a wrong SKU is worse than no SKU.
 *
 * Nothing in here ever guesses. A fuzzy name match is not a part number.
 */

export type CotsPart = {
  name: string;
  vendor: string;
  sku: string;
};

export type CotsCatalog = (nameOrSpec: string) => CotsPart | null;

let registered: CotsCatalog | null = null;

/**
 * Install a catalog. The parts-catalog module calls this once at startup; tests
 * call it with a stub. Passing null removes it again.
 */
export function registerCotsCatalog(catalog: CotsCatalog | null): void {
  registered = catalog;
}

export function cotsCatalogInstalled(): boolean {
  return registered !== null;
}

/**
 * The interface the rest of the engine uses. Null means "no catalog, or no
 * confident match" — the caller must fall back to the CAD part name.
 */
export function lookupCotsPart(nameOrSpec: string): CotsPart | null {
  const query = String(nameOrSpec ?? "").trim();
  if (!query || !registered) return null;
  try {
    const hit = registered(query);
    if (!hit) return null;
    const name = String(hit.name ?? "").trim();
    const vendor = String(hit.vendor ?? "").trim();
    const sku = String(hit.sku ?? "").trim();
    // A catalog entry without a vendor and SKU is not more useful than the CAD
    // name, and printing a half-populated row implies a sourcing decision the
    // catalog did not actually make.
    if (!name || !vendor || !sku) return null;
    return { name, vendor, sku };
  } catch {
    return null;
  }
}

/**
 * Table names the reference catalog might use. Probed rather than assumed
 * because the catalog migration is being written in parallel; a name that is
 * not there simply does not match.
 */
const CANDIDATE_TABLES = ["parts_catalog_ref", "cots_parts_ref", "parts_catalog"] as const;

type CatalogRow = { name: string; vendor: string; sku: string; aliases: string[] | null };

/**
 * Build an in-memory catalog from the reference table, when it exists.
 *
 * Returns null — not an error — when the table has not been migrated yet, so a
 * run on a deployment without the catalog completes with CAD names and says so
 * in the report.
 */
export async function loadCotsCatalogFromDb(client: PoolClient): Promise<CotsCatalog | null> {
  let table: string | null = null;
  for (const candidate of CANDIDATE_TABLES) {
    const probe = await client.query<{ present: string | null }>(
      `SELECT to_regclass('public.' || $1::text)::text AS present`,
      [candidate],
    );
    if (probe.rows[0]?.present) {
      table = candidate;
      break;
    }
  }
  if (!table) return null;

  // The columns we need. If the catalog shipped a different shape, we do not
  // guess at a mapping — we behave as if there were no catalog.
  const columns = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1::text`,
    [table],
  );
  const present = new Set(columns.rows.map((row) => row.column_name));
  const skuColumn = ["sku", "part_number", "vendor_sku"].find((name) => present.has(name));
  if (!present.has("name") || !present.has("vendor") || !skuColumn) return null;
  const aliasColumn = ["aliases", "alt_names"].find((name) => present.has(name)) ?? null;

  // Parameterising an identifier is not possible, so the identifiers are chosen
  // from the fixed allowlists above and never from caller input.
  const sql =
    `SELECT name, vendor, ${skuColumn} AS sku, ` +
    `${aliasColumn ? `${aliasColumn}::text[]` : "NULL::text[]"} AS aliases ` +
    `FROM ${table} LIMIT 20000`;
  const rows = await client.query<CatalogRow>(sql);

  const index = new Map<string, CotsPart>();
  for (const row of rows.rows) {
    const part: CotsPart = {
      name: String(row.name ?? "").trim(),
      vendor: String(row.vendor ?? "").trim(),
      sku: String(row.sku ?? "").trim(),
    };
    if (!part.name || !part.vendor || !part.sku) continue;
    for (const key of [part.name, part.sku, ...(row.aliases ?? [])]) {
      const normalized = normalizeKey(key);
      if (normalized && !index.has(normalized)) index.set(normalized, part);
    }
  }
  if (!index.size) return null;

  return (nameOrSpec) => index.get(normalizeKey(nameOrSpec)) ?? null;
}

/**
 * Exact match on a normalised key only. Onshape part names carry instance
 * suffixes ("10-32 SHCS <3>") and separator noise, so those are stripped — but
 * nothing here does substring or edit-distance matching, because "8-32 x 1.00"
 * and "8-32 x 1.50" differ by one character and are different bolts.
 */
export function normalizeKey(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/<\s*\d+\s*>\s*$/, "")
    .replace(/[\s_]+/g, " ")
    .replace(/["']/g, "")
    .trim();
}
