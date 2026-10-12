import { describe, expect, it } from "vitest";
import { defaultPinHrefs } from "./pins";
import { PINS_NEED_UPDATE, readPins, savePins } from "./pins-store";

type Call = { text: string; values?: unknown[] };

/** A fake withRls client: answers SELECTs from `row`, records every statement. */
function fakeClient(options: { row?: { pinned?: unknown; island?: unknown }; withoutColumn?: boolean } = {}) {
  const calls: Call[] = [];
  const client = {
    calls,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (options.withoutColumn && /pinned_apps/.test(text) && !/SAVEPOINT/.test(text)) {
        throw Object.assign(new Error('column "pinned_apps" does not exist'), { code: "42703" });
      }
      if (/^SELECT/.test(text.trim())) {
        return { rows: (options.row ? [options.row] : []) as unknown as Row[] };
      }
      return { rows: [] as Row[] };
    },
  };
  return client;
}

const USER = "00000000-0000-4000-8000-000000000001";

describe("reading pins", () => {
  it("returns the stock pins for someone who never saved any", async () => {
    expect(await readPins(fakeClient(), USER)).toEqual({ tabs: defaultPinHrefs(), isDefault: true });
    expect(await readPins(fakeClient({ row: { pinned: null, island: [] } }), USER)).toEqual({ tabs: defaultPinHrefs(), isDefault: true });
  });

  it("returns saved pins, and a custom bar saved before pins existed", async () => {
    const saved = await readPins(fakeClient({ row: { pinned: ["/files", "/dashboard"], island: [] } }), USER);
    expect(saved).toEqual({ tabs: ["/files", "/dashboard"], isDefault: false });
    const bar = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"];
    expect(await readPins(fakeClient({ row: { pinned: null, island: bar } }), USER)).toEqual({ tabs: bar, isDefault: false });
  });

  it("falls back to the old bar on a server without 0729, inside a savepoint", async () => {
    const bar = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"];
    const client = fakeClient({ row: { island: bar }, withoutColumn: true });
    expect(await readPins(client, USER)).toEqual({ tabs: bar, isDefault: false });
    expect(client.calls.map((call) => call.text.split(/\s+/)[0])).toEqual(["SAVEPOINT", "SELECT", "ROLLBACK", "SELECT"]);
  });
});

describe("saving pins", () => {
  it("saves up to eight places and keeps the old bar column in step", async () => {
    const client = fakeClient();
    const tabs = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business", "/files"];
    expect(await savePins(client, USER, { tabs })).toEqual({ ok: true, view: { tabs, isDefault: false } });
    const insert = client.calls.find((call) => call.text.includes("INSERT"))!;
    expect(insert.values).toEqual([USER, JSON.stringify(tabs), JSON.stringify(tabs.slice(0, 4))]);
    expect(insert.text).toMatch(/\$1::uuid, \$2::jsonb, \$3::jsonb/);
  });

  it("stores the stock pins (and Reset) as 'follow the defaults'", async () => {
    for (const input of [{ tabs: defaultPinHrefs() }, { reset: true }]) {
      const client = fakeClient();
      expect(await savePins(client, USER, input)).toEqual({ ok: true, view: { tabs: defaultPinHrefs(), isDefault: true } });
      expect(client.calls.find((call) => call.text.includes("INSERT"))!.values).toEqual([USER, null, "[]"]);
    }
  });

  it("refuses an empty, oversized or unknown list with a plain message", async () => {
    for (const tabs of [[], ["/dashboard", "/dashboard"], ["/admin"], "nope"]) {
      const result = await savePins(fakeClient(), USER, { tabs });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("keeps working without 0729 for a bar of four, and says what to do otherwise", async () => {
    const four = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"];
    const ok = fakeClient({ withoutColumn: true });
    expect(await savePins(ok, USER, { tabs: four })).toMatchObject({ ok: true });
    expect(ok.calls.at(-1)!.values).toEqual([USER, JSON.stringify(four)]);

    const reset = fakeClient({ withoutColumn: true });
    expect(await savePins(reset, USER, { reset: true })).toMatchObject({ ok: true, view: { isDefault: true } });
    expect(reset.calls.at(-1)!.values).toEqual([USER, "[]"]);

    const five = await savePins(fakeClient({ withoutColumn: true }), USER, { tabs: [...four, "/files"] });
    expect(five).toEqual({ ok: false, status: 503, error: PINS_NEED_UPDATE });
    expect(PINS_NEED_UPDATE).not.toMatch(/pinned_apps|migration|0729/);
  });
});
