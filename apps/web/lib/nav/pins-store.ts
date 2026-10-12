/**
 * Reading and saving a person's pinned apps ("Your apps"). Server-only; the route passes the
 * client from withRls({ userId }), so profiles RLS keeps each person to their own row.
 *
 * profiles.pinned_apps arrives with 0729. Until a server has applied it, reads fall back to the
 * bottom bar saved in island_tabs, and saves that still fit there (four places) keep working;
 * anything else answers with a plain "needs an update" message instead of a 500.
 */
import {
  BAR_SLOTS,
  defaultPinHrefs,
  isDefaultPinSelection,
  isValidPinSelection,
  legacyBarFor,
  resolveStoredPins,
  canonicalPinHref,
  PIN_LIMIT,
} from "./pins";

type Queryable = {
  query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
};

export type PinsView = {
  /** Every pinned href, in order. The bottom bar shows the first four. */
  tabs: string[];
  /** True while the person is on the stock pins (nothing saved, or reset). */
  isDefault: boolean;
};

export type SavePinsResult =
  | { ok: true; view: PinsView }
  | { ok: false; status: 400 | 503; error: string };

function missingPinnedColumn(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42703" || (code === undefined && /column "?pinned_apps"? .*does not exist/i.test(message));
}

/**
 * Run one statement that may meet a server without 0729. withRls runs in a transaction, and a
 * failed statement aborts it, so the attempt sits inside a savepoint the fallback can rewind.
 * Resolves to null when the column is missing; any other error is thrown as usual.
 */
async function withPinnedColumn<T>(client: Queryable, run: () => Promise<T>): Promise<T | null> {
  await client.query("SAVEPOINT pinned_apps_attempt");
  try {
    const value = await run();
    await client.query("RELEASE SAVEPOINT pinned_apps_attempt");
    return value;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pinned_apps_attempt");
    if (missingPinnedColumn(error)) return null;
    throw error;
  }
}

export const PINS_NEED_UPDATE =
  "This server can keep exactly four pinned apps until it gets the latest Vantage update. Pin four for now, or ask whoever runs Vantage for your team to update it.";

export async function readPins(client: Queryable, userId: string): Promise<PinsView> {
  const current = await withPinnedColumn(client, async () => {
    const result = await client.query<{ pinned: unknown; island: unknown }>(
      `SELECT pinned_apps AS pinned, island_tabs AS island FROM profiles WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    const tabs = resolveStoredPins(row?.pinned, row?.island);
    return { tabs, isDefault: row?.pinned == null && isDefaultPinSelection(tabs) };
  });
  if (current) return current;
  const legacy = await client.query<{ island: unknown }>(
    `SELECT island_tabs AS island FROM profiles WHERE user_id = $1::uuid`,
    [userId],
  );
  const tabs = resolveStoredPins(null, legacy.rows[0]?.island);
  return { tabs, isDefault: isDefaultPinSelection(tabs) };
}

/**
 * Save `tabs` (1–8 pinnable places) or, with `reset`, go back to the stock pins. Choosing
 * exactly the stock pins also counts as a reset, so the person follows future defaults.
 */
export async function savePins(
  client: Queryable,
  userId: string,
  input: { tabs?: unknown; reset?: unknown },
): Promise<SavePinsResult> {
  const reset = input.reset === true;
  if (!reset && !isValidPinSelection(input.tabs)) {
    return {
      ok: false,
      status: 400,
      error: `Choose between 1 and ${PIN_LIMIT} different apps to pin.`,
    };
  }
  const tabs = reset ? defaultPinHrefs() : (input.tabs as string[]).map(canonicalPinHref);
  const isDefault = isDefaultPinSelection(tabs);
  const pinned = isDefault ? null : JSON.stringify(tabs);
  const bar = JSON.stringify(isDefault ? [] : legacyBarFor(tabs));
  const saved = await withPinnedColumn(client, async () => {
    await client.query(
      `INSERT INTO profiles(user_id, pinned_apps, island_tabs)
       VALUES($1::uuid, $2::jsonb, $3::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET pinned_apps = excluded.pinned_apps, island_tabs = excluded.island_tabs`,
      [userId, pinned, bar],
    );
    return true;
  });
  if (saved) return { ok: true, view: { tabs, isDefault } };
  // Before 0729: only a bar of exactly four (or the default) can be kept.
  const legacyBar = isDefault ? [] : legacyBarFor(tabs);
  if (!isDefault && (tabs.length !== BAR_SLOTS || legacyBar.length !== BAR_SLOTS)) {
    return { ok: false, status: 503, error: PINS_NEED_UPDATE };
  }
  await client.query(
    `INSERT INTO profiles(user_id, island_tabs)
     VALUES($1::uuid, $2::jsonb)
     ON CONFLICT(user_id) DO UPDATE SET island_tabs = excluded.island_tabs`,
    [userId, JSON.stringify(legacyBar)],
  );
  return { ok: true, view: { tabs, isDefault } };
}
