import { describe, expect, it } from "vitest";
import { appsScriptSource } from "./apps-script-source";

// Execute the shipped script, including its real ledger and lock behavior.
function scriptHarness() {
  let now = 1_800_000_000_000;
  let held = false;
  let calls = 0;
  let providerFailure: string | null = null;
  let ambiguousFailure = false;
  const props = new Map<string, string>();
  const books = new Map<string, { getId: () => string }>();
  const lock = { hasLock: () => held, waitLock() { if (held) throw new Error("Nested lock"); held = true; }, releaseLock() { held = false; } };
  const globals = {
    Date: class extends Date { static now() { return now; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props.get(key) ?? null, setProperty: (key: string, value: string) => { props.set(key, value); } }) },
    LockService: { getScriptLock: () => lock },
    DriveApp: {
      getFilesByName: (name: string) => ({ hasNext: () => books.has(name), next: () => books.get(name)! }),
    },
    SpreadsheetApp: {
      openById: (id: string) => [...books.values()].find((book) => book.getId() === id),
      create: (title: string) => {
        expect(held).toBe(true);
        calls++;
        if (providerFailure) throw new Error(providerFailure);
        const book = { getId: () => `book-${calls}` };
        books.set(title, book);
        if (ambiguousFailure) throw new Error("Response lost after create");
        return book;
      },
    },
  };
  const script = new Function(...Object.keys(globals), `${appsScriptSource("a".repeat(64))}\nreturn {create: vantageCreateSpreadsheet_, recovery: vantageRecoveryBook_};`)(...Object.values(globals)) as {
    create(title: string): { getId(): string }; recovery(key: string, create: boolean): unknown;
  };
  return { script, props, lock, calls: () => calls, held: () => held, advance: (ms: number) => { now += ms; }, fail: (message: string | null) => { providerFailure = message; }, ambiguous: (value: boolean) => { ambiguousFailure = value; } };
}

describe("personal Gmail spreadsheet creation budget", () => {
  it("accounts for all creation paths through one locked helper", () => {
    expect(appsScriptSource("a".repeat(64)).match(/SpreadsheetApp\.create\(/g)).toHaveLength(1);
    const h = scriptHarness();
    for (let i = 0; i < 250; i++) h.script.create(`workbook-${i}`);
    expect(() => h.script.create("recovery-next")).toThrow(expect.objectContaining({ code: "daily_quota", retryAfterMs: 86_400_000 }));
    expect(h.calls()).toBe(250);
    expect(h.held()).toBe(false);
    expect(h.props.get("VANTAGE_CREATE_LEDGER")!.length).toBeLessThan(9 * 1024);
    h.advance(86_400_000);
    expect(h.script.create("recovery-next").getId()).toBe("book-251");
  });
  it("recovers an ambiguous successful creation without charging another reservation", () => {
    const h = scriptHarness();
    h.ambiguous(true);
    expect(() => h.script.create("Vantage pending workbook - stable")).toThrow(/Response lost/);
    h.ambiguous(false);
    const ledger = h.props.get("VANTAGE_CREATE_LEDGER");
    expect(h.script.create("Vantage pending workbook - stable").getId()).toBe("book-1");
    expect(h.props.get("VANTAGE_CREATE_LEDGER")).toBe(ledger);
    expect(h.calls()).toBe(1);
  });
  it("blocks creation after Google reports quota consumed elsewhere, then resumes", () => {
    const h = scriptHarness();
    h.fail("Limit exceeded: Spreadsheets.");
    expect(() => h.script.create("first")).toThrow(expect.objectContaining({ code: "daily_quota" }));
    h.fail(null);
    h.advance(1000);
    expect(() => h.script.create("second")).toThrow(expect.objectContaining({ retryAfterMs: 86_399_000 }));
    expect(h.calls()).toBe(1);
    h.advance(86_399_000);
    expect(h.script.create("second").getId()).toBe("book-2");
  });
  it("does not reacquire or release its caller's lock", () => {
    const h = scriptHarness();
    h.lock.waitLock();
    h.script.create("nested");
    expect(h.held()).toBe(true);
    h.lock.releaseLock();
  });
  it("never provisions resources just to read or inspect a missing recovery book", () => {
    const h = scriptHarness();
    expect(() => h.script.recovery("missing-book", false)).toThrow(/not found/);
    expect(h.calls()).toBe(0);
    expect(h.props.size).toBe(0);
  });
  it("fails closed on a damaged ledger instead of silently resetting it", () => {
    const h = scriptHarness();
    h.props.set("VANTAGE_CREATE_LEDGER", JSON.stringify({ attempts: ["bad"], blockedUntil: 0 }));
    expect(() => h.script.create("cannot-create")).toThrow(/operator attention/);
    expect(h.calls()).toBe(0);
    expect(h.held()).toBe(false);
  });
});
