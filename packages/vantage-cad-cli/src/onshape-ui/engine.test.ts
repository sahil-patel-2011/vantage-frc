import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { createOnshapeUiEngine, parseUiDocumentBinding } from "./engine";
import type { UiControl } from "./types";

const DOCUMENT = "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc";
const CONTROLS: Record<string, UiControl> = {
  length: { locator: { kind: "label", label: "Length" }, scope: "document", allowedActions: ["fill"], impact: "edit" },
  save: { locator: { kind: "role", role: "button", name: "Confirm" }, scope: "document", allowedActions: ["click", "right-click", "press"], allowedKeys: ["Enter"], impact: "edit" },
  remove: { locator: { kind: "testId", testId: "remove" }, scope: "document", allowedActions: ["click"], impact: "destructive" },
  canvas: { locator: { kind: "css", selector: "#observed-canvas" }, scope: "document", allowedActions: ["canvas-click"], impact: "edit", canvas: true },
  done: { locator: { kind: "role", role: "status", name: "Saved" }, scope: "document", allowedActions: [], impact: "inspect" },
  features: { locator: { kind: "named-item", scope: "#feature-tree", itemSelector: ".feature-name" }, scope: "document", allowedActions: ["click", "right-click"], impact: "inspect" },
};

function fixture() {
  let url = DOCUMENT;
  let aria = "- main: Part Studio";
  let value = "10 mm";
  let time = 100;
  const bounds = { x: 100, y: 100, width: 600, height: 400 };
  const target = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    getAttribute: vi.fn(async (_name: string): Promise<string | null> => null),
    locator: vi.fn((_selector: string): unknown => ({ count: async () => 0 })),
    boundingBox: vi.fn(async () => bounds),
    ariaSnapshot: vi.fn(async () => aria),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async (next: string) => { value = next; }),
    selectOption: vi.fn(async () => []),
    press: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined),
    inputValue: vi.fn(async () => value),
    isChecked: vi.fn(async () => false),
    innerText: vi.fn(async () => "Saved"),
  };
  const png = Buffer.alloc(24);
  png.writeUInt32BE(1000, 16);
  png.writeUInt32BE(700, 20);
  const page = {
    url: () => url,
    locator: vi.fn(() => target), getByRole: vi.fn(() => target),
    getByLabel: vi.fn(() => target), getByTestId: vi.fn(() => target),
    screenshot: vi.fn(async () => png),
  };
  const authorize = vi.fn(async () => undefined);
  const engine = createOnshapeUiEngine({ page: page as unknown as Page, controls: CONTROLS, authorize, now: () => time });
  return { page, target, engine, authorize, setUrl: (next: string) => { url = next; }, setAria: (next: string) => { aria = next; }, advance: () => { time += 120_001; } };
}

describe("Onshape UI engine safety and evidence", () => {
  it("keeps the authoritative binding visible across observations and manual tab changes", async () => {
    const f = fixture();
    const initial = await f.engine.observe(["length"]);
    expect(initial.binding).toBeNull();
    const bound = await f.engine.bind(initial.id);
    expect((await f.engine.observe(["length"])).binding).toEqual(bound);
    f.setUrl(DOCUMENT.replace(/c{24}$/, "dddddddddddddddddddddddd"));
    const changed = await f.engine.observe(["length"]);
    expect(changed.binding?.elementId).toBe("cccccccccccccccccccccccc");
    expect(parseUiDocumentBinding(changed.url)?.elementId).toBe("dddddddddddddddddddddddd");
    await f.engine.clearBinding();
    expect((await f.engine.observe(["length"])).binding).toBeNull();
  });

  it("reads only opted-in visible fields with bounded values and unit labels", async () => {
    const f = fixture();
    const controls: Record<string, UiControl> = {
      measured: { ...CONTROLS.length!, read: "value" },
      warning: { ...CONTROLS.done!, read: "text" },
      override: { ...CONTROLS.done!, read: "checked" },
      ordinary: CONTROLS.length!,
    };
    f.target.getAttribute.mockImplementation(async (name) => name === "data-bs-original-title" ? "Mass: 0.065 kg" : null);
    f.target.inputValue.mockResolvedValue("0.065 kg");
    const engine = createOnshapeUiEngine({ page: f.page as unknown as Page, controls, authorize: f.authorize });
    const seen = await engine.observe();
    expect(seen.controls.measured).toMatchObject({ value: "0.065 kg", title: "Mass: 0.065 kg" });
    expect(seen.controls.warning?.text).toBe("Saved");
    expect(seen.controls.override?.checked).toBe(false);
    expect(seen.controls.ordinary).not.toHaveProperty("value");
    expect(f.target.inputValue).toHaveBeenCalledTimes(1);
    f.target.inputValue.mockResolvedValue("1".repeat(3000));
    expect((await engine.observe(["measured"])).controls.measured?.value).toHaveLength(2000);
    f.target.isVisible.mockResolvedValue(false);
    expect((await engine.observe(["measured"])).controls.measured).not.toHaveProperty("value");
    expect(f.target.inputValue).toHaveBeenCalledTimes(2);
  });

  it("does not read a mapped input if the site changes it into a password field", async () => {
    const f = fixture();
    f.target.getAttribute.mockImplementation(async (name) => name === "type" ? "password" : null);
    const engine = createOnshapeUiEngine({ page: f.page as unknown as Page,
      controls: { field: { ...CONTROLS.length!, read: "value" } }, authorize: f.authorize });
    expect((await engine.observe()).controls.field).not.toHaveProperty("value");
    expect(f.target.inputValue).not.toHaveBeenCalled();
  });

  it("bounds independent observation reads to eight and preserves requested order", async () => {
    const f = fixture();
    const controls: Record<string, UiControl> = {};
    const waiting: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    for (let index = 0; index < 19; index += 1) {
      controls[`control-${index}`] = { ...CONTROLS.done!, locator: { kind: "css", selector: `#control-${index}` } };
    }
    f.page.locator.mockImplementation(() => ({
      ...f.target,
      count: vi.fn(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => waiting.push(resolve));
        active -= 1;
        return 1;
      }),
    }));
    const engine = createOnshapeUiEngine({ page: f.page as unknown as Page, controls, authorize: f.authorize });
    const reading = engine.observe();
    for (const size of [8, 8, 3]) {
      // Flush only promise continuations; no browser, timers or sleeps needed.
      for (let tick = 0; tick < 40 && waiting.length < size; tick += 1) await Promise.resolve();
      expect(waiting).toHaveLength(size);
      for (const resolve of waiting.splice(0).reverse()) resolve();
    }
    const seen = await reading;
    expect(maximum).toBe(8);
    expect(active).toBe(0);
    expect(Object.keys(seen.controls)).toEqual(Object.keys(controls));
    expect(f.target.click).not.toHaveBeenCalled();
  });

  it("rejects an observation if navigation occurs while capturing the screenshot", async () => {
    const f = fixture();
    const png = await f.page.screenshot();
    f.page.screenshot.mockImplementation(async () => {
      f.setUrl(DOCUMENT.replace(/c{24}$/, "dddddddddddddddddddddddd"));
      return png;
    });
    await expect(f.engine.observe(["save", "length"])).rejects.toThrow("navigated during observation");
  });

  it("binds only HTTPS workspace elements and rejects versions, lookalike hosts and credentials", () => {
    expect(parseUiDocumentBinding(DOCUMENT)?.elementId).toBe("cccccccccccccccccccccccc");
    for (const invalid of [DOCUMENT.replace("/w/", "/v/"), DOCUMENT.replace("https:", "http:"), DOCUMENT.replace("cad.onshape.com", "cad.onshape.com.attacker.test"), DOCUMENT.replace("https://", "https://user:secret@"), DOCUMENT.replace("/e/", "/api/")]) {
      expect(parseUiDocumentBinding(invalid)).toBeNull();
    }
  });

  it("requires pilot authorization before revealing browser observations", async () => {
    const f = fixture();
    f.authorize.mockRejectedValueOnce(new Error("Membership revoked"));
    await expect(f.engine.observe()).rejects.toThrow("Membership revoked");
    expect(f.page.screenshot).not.toHaveBeenCalled();
  });

  it("uses exact locators and verifies the resulting input value without claiming geometry verification", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["length"]);
    await f.engine.bind(seen.id);
    const result = await f.engine.execute({ observationId: seen.id, controlId: "length", action: "fill", value: "25 mm", postcondition: { controlId: "length", kind: "value", expected: "25 mm" } });
    expect(f.page.getByLabel).toHaveBeenCalledWith("Length", { exact: true });
    expect(result.status).toBe("verified");
    expect(result.verification).toBe("ui-postcondition");
    expect(result.message).toContain("Geometry is not certified");
    expect(f.authorize).toHaveBeenCalledTimes(3);
  });

  it("requires a fresh observation after every action, including queued concurrent commands", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    const command = { observationId: seen.id, controlId: "save", action: "click" as const };
    const first = f.engine.execute(command);
    const second = f.engine.execute(command);
    await expect(first).resolves.toMatchObject({ status: "unverified", actionPerformed: true });
    await expect(second).rejects.toThrow("stale");
    expect(f.target.click).toHaveBeenCalledTimes(1);
  });

  it("refuses unbound documents, changed tabs and expired snapshots", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" })).rejects.toThrow("Bind this exact");
    await f.engine.bind(seen.id);
    f.setUrl(DOCUMENT.replace(/c{24}$/, "dddddddddddddddddddddddd"));
    const changed = await f.engine.observe(["save"]);
    await expect(f.engine.execute({ observationId: changed.id, controlId: "save", action: "click" })).rejects.toThrow("Bind this exact");
    await f.engine.bind(changed.id);
    f.advance();
    await expect(f.engine.execute({ observationId: changed.id, controlId: "save", action: "click" })).rejects.toThrow("stale");
    expect(f.target.click).not.toHaveBeenCalled();
  });

  it("refuses stale UI, unsupported keys, unknown controls and unobserved controls", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "arbitrary-css", action: "click" })).rejects.toThrow("Unknown UI control");
    await expect(f.engine.execute({ observationId: seen.id, controlId: "length", action: "fill", value: "30 mm" })).rejects.toThrow("Observe one");
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "press", key: "Control+a" })).rejects.toThrow("key is not allowed");
    f.setAria("- dialog: Delete part?");
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" })).rejects.toThrow("visible UI changed");
    expect(f.target.click).not.toHaveBeenCalled();
    expect(f.target.press).not.toHaveBeenCalled();
  });

  it("does not retry or claim success for an uncertain click", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    f.target.click.mockRejectedValueOnce(new Error("Timeout after dispatch"));
    const result = await f.engine.execute({ observationId: seen.id, controlId: "save", action: "click", postcondition: { controlId: "done", kind: "visible" } });
    expect(result).toMatchObject({ status: "unverified", actionPerformed: false, verification: "none" });
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" })).rejects.toThrow("stale");
    expect(f.target.click).toHaveBeenCalledTimes(1);
  });

  it("refuses destructive clicks without host approval", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["remove"]);
    await f.engine.bind(seen.id);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "remove", action: "click" })).rejects.toThrow("explicit approval");
    expect(f.target.click).not.toHaveBeenCalled();
  });

  it("accepts canvas positions only within the observed screenshot and canvas", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["canvas"]);
    await f.engine.bind(seen.id);
    expect(seen.viewport).toEqual({ width: 1000, height: 700 });
    await expect(f.engine.execute({ observationId: seen.id, controlId: "canvas", action: "canvas-click", x: 50, y: 200 })).rejects.toThrow("inside the canvas");
    await f.engine.execute({ observationId: seen.id, controlId: "canvas", action: "canvas-click", x: 250, y: 220 });
    expect(f.target.click).toHaveBeenCalledWith({ position: { x: 150, y: 120 }, timeout: 5000 });
  });

  it("checks membership again for each command and fails closed after departure", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    f.authorize.mockRejectedValueOnce(new Error("Membership revoked"));
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" })).rejects.toThrow("Membership revoked");
    expect(f.target.click).not.toHaveBeenCalled();
  });

  it("rejects camera or geometry changes with unchanged ARIA and canvas bounds", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["canvas"]);
    await f.engine.bind(seen.id);
    const changedImage = Buffer.from(seen.screenshotBase64, "base64");
    changedImage[0] = 1;
    f.page.screenshot.mockResolvedValue(changedImage);
    const command = { observationId: seen.id, controlId: "canvas", action: "canvas-click" as const, x: 250, y: 220 };
    await expect(f.engine.execute(command)).rejects.toThrow("viewport image changed");
    expect(f.target.click).not.toHaveBeenCalled();
    await expect(f.engine.execute(command)).rejects.toThrow("stale");
    const fresh = await f.engine.observe(["canvas"]);
    await f.engine.execute({ ...command, observationId: fresh.id });
    expect(f.target.click).toHaveBeenCalledTimes(1);
  });

  it("does not require pixel equality for ordinary exact-locator actions", async () => {
    const f = fixture();
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    const changedImage = Buffer.from(seen.screenshotBase64, "base64");
    changedImage[0] = 1;
    f.page.screenshot.mockResolvedValue(changedImage);
    await f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" });
    expect(f.target.click).toHaveBeenCalledTimes(1);
    expect(f.page.screenshot).toHaveBeenCalledTimes(2); // Before/after observations only.
  });

  it("treats disabled DIV tools as unavailable even when Playwright isEnabled returns true", async () => {
    const f = fixture();
    f.target.getAttribute.mockImplementation(async (name) => name === "class" ? "tool disabled is-activatable" : null);
    const seen = await f.engine.observe(["save"]);
    await f.engine.bind(seen.id);
    expect(seen.controls.save?.enabled).toBe(false);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "save", action: "click" })).rejects.toThrow("Observe one");
    expect(f.target.click).not.toHaveBeenCalled();
  });

  it("selects exact observed feature names inside the trusted tree and opens their context menu", async () => {
    const f = fixture();
    const feature = { ...f.target, innerText: vi.fn(async () => "Mount plate"), click: vi.fn(async () => undefined) };
    f.target.locator.mockImplementation((selector) => selector === ".feature-name" ? { count: async () => 1, nth: () => feature } : { count: async () => 0 });
    const seen = await f.engine.observe(["features"]);
    await f.engine.bind(seen.id);
    expect(seen.controls.features?.names).toEqual(["Mount plate"]);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "features", action: "right-click", targetText: "Invented part" })).rejects.toThrow("exact rendered name");
    await f.engine.execute({ observationId: seen.id, controlId: "features", action: "right-click", targetText: "Mount plate" });
    expect(feature.click).toHaveBeenCalledWith({ button: "right", timeout: 5000 });
  });

  it("refuses duplicate feature names instead of choosing the first matching part", async () => {
    const f = fixture();
    const feature = { ...f.target, innerText: vi.fn(async () => "Part 1") };
    f.target.locator.mockImplementation((selector) => selector === ".feature-name" ? { count: async () => 2, nth: () => feature } : { count: async () => 0 });
    const seen = await f.engine.observe(["features"]);
    await f.engine.bind(seen.id);
    await expect(f.engine.execute({ observationId: seen.id, controlId: "features", action: "click", targetText: "Part 1" })).rejects.toThrow("ambiguous");
    expect(f.target.click).not.toHaveBeenCalled();
  });
});
