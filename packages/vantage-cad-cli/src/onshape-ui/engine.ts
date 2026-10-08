import { randomUUID } from "node:crypto";
import type { Locator } from "playwright";
import type {
  OnshapeUiEngineOptions, UiAuthorizationContext, UiBounds, UiCommand,
  UiCommandResult, UiControl, UiDocumentBinding, UiObservation, UiPostcondition,
} from "./types";

const SAFE_KEYS = new Set(["Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Space"]);
const TIMEOUT_MS = 5_000;
const MAX_NAMED_ITEMS = 2_000;
const CAPTURE_CONCURRENCY = 8;

export function parseUiDocumentBinding(raw: string): UiDocumentBinding | null {
  try {
    const url = new URL(raw);
    if (!isOnshapeOrigin(url)) return null;
    const match = /^\/documents\/([a-f0-9]{24})\/w\/([a-f0-9]{24})\/e\/([a-f0-9]{24})\/?$/i.exec(url.pathname);
    return match ? { origin: url.origin, documentId: match[1]!, workspaceId: match[2]!, elementId: match[3]! } : null;
  } catch { return null; }
}

function isOnshapeOrigin(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (url.hostname === "onshape.com" || url.hostname.endsWith(".onshape.com"));
}

function assertSurface(raw: string): URL {
  const url = new URL(raw);
  if (!isOnshapeOrigin(url) || !/^\/documents(?:\/|$)/.test(url.pathname)) {
    throw new Error("Open the signed-in Onshape documents page or a workspace before using CAD tools.");
  }
  return url;
}

function sameBinding(a: UiDocumentBinding | null, b: UiDocumentBinding | null): boolean {
  return Boolean(a && b && a.origin === b.origin && a.documentId === b.documentId &&
    a.workspaceId === b.workspaceId && a.elementId === b.elementId);
}

function sameBounds(a: UiBounds, b: UiBounds | null): boolean {
  return Boolean(b && ["x", "y", "width", "height"].every((key) =>
    Math.abs(a[key as keyof UiBounds] - b[key as keyof UiBounds]) < 0.5));
}

/** UI-only Playwright adapter. No HTTP client, browser script evaluation or cookie access. */
export function createOnshapeUiEngine(options: OnshapeUiEngineOptions) {
  const { page } = options;
  const now = options.now ?? Date.now;
  let binding: UiDocumentBinding | null = null;
  let latest: UiObservation | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function control(id: string): UiControl {
    if (!Object.prototype.hasOwnProperty.call(options.controls, id)) throw new Error("Unknown UI control. Refresh the supported control map.");
    return options.controls[id]!;
  }

  function locator(id: string): Locator {
    const target = control(id).locator;
    switch (target.kind) {
      case "role": return (target.scope ? page.locator(target.scope) : page).getByRole(target.role, { name: target.name, exact: true });
      case "label": return page.getByLabel(target.label, { exact: true });
      case "testId": return page.getByTestId(target.testId);
      case "text": return (target.scope ? page.locator(target.scope) : page).getByText(target.text, { exact: true });
      case "named-item": return page.locator(target.scope);
      case "css": return page.locator(target.selector);
    }
  }

  async function enabled(target: Locator): Promise<boolean> {
    if (!await target.isEnabled() || await target.getAttribute("aria-disabled") === "true") return false;
    const classes = (await target.getAttribute("class") ?? "").split(/\s+/);
    if (classes.some((name) => name === "disabled" || name === "is-disabled")) return false;
    // Onshape tool DIVs also inherit disabled state from their toolbar item.
    return await target.locator("xpath=ancestor::*[@aria-disabled='true' or contains(concat(' ', normalize-space(@class), ' '), ' disabled ') or contains(concat(' ', normalize-space(@class), ' '), ' is-disabled ')]").count() === 0;
  }

  async function namedItems(id: string): Promise<Array<{ name: string; locator: Locator }>> {
    const definition = control(id).locator;
    if (definition.kind !== "named-item") return [];
    const items = page.locator(definition.scope).locator(definition.itemSelector);
    const count = await items.count();
    if (count > MAX_NAMED_ITEMS) throw new Error("This tree is too large to map safely. Narrow the visible tree before observing.");
    const results: Array<{ name: string; locator: Locator }> = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      if (!await item.isVisible() || !await enabled(item)) continue;
      const name = (await item.innerText({ timeout: TIMEOUT_MS })).trim();
      if (name && name.length <= 500) results.push({ name, locator: item });
    }
    return results;
  }

  async function capture(ids: string[]): Promise<UiObservation> {
    const url = page.url();
    assertSurface(url);
    const controls: UiObservation["controls"] = {};
    const canvasBounds: UiObservation["canvasBounds"] = {};
    const uniqueIds = [...new Set(ids)];
    for (let offset = 0; offset < uniqueIds.length; offset += CAPTURE_CONCURRENCY) {
      // Only independent reads overlap. Settle the entire bounded batch before
      // publishing ordered results or rejecting, so no reads outlive capture.
      const results = await Promise.allSettled(uniqueIds.slice(offset, offset + CAPTURE_CONCURRENCY).map(async (id) => {
        const definition = control(id);
        const target = locator(id);
        const count = await target.count();
        const visible = count === 1 && await target.isVisible();
        const state: UiObservation["controls"][string] = { count, visible, enabled: visible && await enabled(target) };
        if (visible && definition.locator.kind === "named-item") {
          state.names = (await namedItems(id)).map((item) => item.name);
        }
        const bounds = visible && definition.canvas ? await target.boundingBox() : null;
        return { id, state, bounds };
      }));
      const failures: unknown[] = [];
      for (const result of results) {
        if (result.status === "rejected") {
          failures.push(result.reason);
          continue;
        }
        const { id, state, bounds } = result.value;
        controls[id] = state;
        if (bounds) canvasBounds[id] = bounds;
      }
      if (failures.length) throw failures[0];
    }
    const aria = await page.locator("body").ariaSnapshot({ timeout: TIMEOUT_MS });
    const screenshot = await page.screenshot({ type: "png", scale: "css", fullPage: false, timeout: TIMEOUT_MS });
    // PNG IHDR dimensions match the returned CSS-scale viewport image even when
    // viewportSize() is null (a normal headed desktop browser window).
    const viewport = { width: screenshot.readUInt32BE(16), height: screenshot.readUInt32BE(20) };
    if (page.url() !== url) throw new Error("The page navigated during observation. Observe again.");
    latest = { id: randomUUID(), at: now(), url, aria, screenshotBase64: screenshot.toString("base64"), viewport, controls, canvasBounds };
    return structuredClone(latest);
  }

  function requireObservation(id: string): UiObservation {
    if (!latest || latest.id !== id || now() - latest.at > (options.observationMaxAgeMs ?? 120_000)) {
      throw new Error("This observation is stale. Observe the current page before acting.");
    }
    if (latest.url !== page.url()) throw new Error("The page changed. Observe it again before acting.");
    return latest;
  }

  function assertControlScope(definition: UiControl) {
    const url = assertSurface(page.url());
    if (definition.scope === "documents") {
      if (!/^\/documents\/?$/.test(url.pathname)) throw new Error("This control is limited to the documents list.");
    } else if (!sameBinding(binding, parseUiDocumentBinding(url.href))) {
      throw new Error("Bind this exact document, workspace and tab before acting here.");
    }
  }

  async function verify(condition: UiPostcondition): Promise<boolean> {
    const target = locator(condition.controlId);
    try {
      if (condition.kind === "visible" || condition.kind === "hidden") {
        await target.waitFor({ state: condition.kind, timeout: TIMEOUT_MS });
        return condition.kind === "hidden" || await target.count() === 1;
      }
      if (await target.count() !== 1 || !await target.isVisible()) return false;
      return condition.kind === "value"
        ? await target.inputValue({ timeout: TIMEOUT_MS }) === condition.expected
        : (await target.innerText({ timeout: TIMEOUT_MS })).trim() === condition.expected.trim();
    } catch { return false; }
  }

  return {
    observe(controlIds: string[] = Object.keys(options.controls)): Promise<UiObservation> {
      return serialized(async () => {
        await options.authorize({ operation: "observe", binding });
        return capture(controlIds);
      });
    },
    bind(observationId: string): Promise<UiDocumentBinding> {
      return serialized(async () => {
        await options.authorize({ operation: "bind", binding });
        const observed = requireObservation(observationId);
        const next = parseUiDocumentBinding(observed.url);
        if (!next) throw new Error("Choose a writable Onshape workspace tab. Versions and snapshots cannot be bound for editing.");
        binding = next;
        return { ...next };
      });
    },
    clearBinding(): Promise<void> {
      return serialized(async () => { binding = null; latest = null; });
    },
    execute(command: UiCommand): Promise<UiCommandResult> {
      // Copy now so a queued caller cannot alter the authorized command later.
      const input = structuredClone(command);
      return serialized(async () => {
        const context: UiAuthorizationContext = { operation: "execute", binding, command: input };
        await options.authorize(context);
        const observed = requireObservation(input.observationId);
        const definition = control(input.controlId);
        assertControlScope(definition);
        if (!definition.allowedActions.includes(input.action)) throw new Error("This action is not allowed for the selected control.");
        const seen = observed.controls[input.controlId];
        if (!seen?.visible || !seen.enabled || seen.count !== 1) throw new Error("Observe one visible, enabled control before acting.");
        if (input.postcondition) control(input.postcondition.controlId);
        if (definition.impact === "destructive") {
          if (!options.approveDestructive) throw new Error("This destructive action requires explicit approval in Vantage.");
          await options.approveDestructive(context);
          await options.authorize(context);
          requireObservation(input.observationId);
          assertControlScope(definition);
        }
        if (await page.locator("body").ariaSnapshot({ timeout: TIMEOUT_MS }) !== observed.aria) {
          latest = null;
          throw new Error("The visible UI changed. Observe it again before acting.");
        }
        let target = locator(input.controlId);
        if (definition.locator.kind === "named-item") {
          if (!input.targetText || !seen.names?.includes(input.targetText)) throw new Error("Select an exact rendered name from the latest tree observation.");
          const matches = (await namedItems(input.controlId)).filter((item) => item.name === input.targetText);
          if (matches.length !== 1) throw new Error("The selected tree name is missing or ambiguous. Observe and choose a unique name.");
          target = matches[0]!.locator;
        } else if (input.targetText !== undefined) {
          throw new Error("Text selection is only available within a registered tree.");
        }
        if (await target.count() !== 1 || !await target.isVisible() || !await enabled(target)) throw new Error("The selected control is no longer available.");
        if ((input.action === "fill" || input.action === "select") && (typeof input.value !== "string" || input.value.length > 20_000)) throw new Error("Provide a bounded text value for this control.");
        if (input.action === "press" && (!input.key || !SAFE_KEYS.has(input.key) || !definition.allowedKeys?.includes(input.key))) throw new Error("This key is not allowed for the selected control.");
        if (input.action === "canvas-click") {
          const bounds = observed.canvasBounds[input.controlId];
          if (!definition.canvas || !bounds || !sameBounds(bounds, await target.boundingBox())) throw new Error("Observe the current canvas bounds before selecting geometry.");
          if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x! < 0 || input.y! < 0 ||
            input.x! >= observed.viewport.width || input.y! >= observed.viewport.height || input.x! < bounds.x ||
            input.y! < bounds.y || input.x! >= bounds.x + bounds.width || input.y! >= bounds.y + bounds.height) {
            throw new Error("The selection must be inside the canvas in the observed viewport image.");
          }
          // Camera movement and geometry changes need not alter ARIA or canvas
          // bounds. Coordinates are valid only for the exact observed image.
          const currentScreenshot = await page.screenshot({ type: "png", scale: "css", fullPage: false, timeout: TIMEOUT_MS });
          if (currentScreenshot.toString("base64") !== observed.screenshotBase64) {
            latest = null;
            throw new Error("The viewport image changed. Observe the current camera and geometry before selecting a canvas position.");
          }
        }
        requireObservation(input.observationId);
        assertControlScope(definition);
        // An uncertain click must never be replayed against the same observation.
        latest = null;
        let actionPerformed = false;
        let message = "Action sent. Inspect the new observation; geometry has not been verified.";
        try {
          switch (input.action) {
            case "click": await target.click({ timeout: TIMEOUT_MS }); break;
            case "double-click": await target.dblclick({ timeout: TIMEOUT_MS }); break;
            case "right-click": await target.click({ button: "right", timeout: TIMEOUT_MS }); break;
            case "fill": await target.fill(input.value!, { timeout: TIMEOUT_MS }); break;
            case "select": await target.selectOption({ label: input.value! }, { timeout: TIMEOUT_MS }); break;
            case "press": await target.press(input.key!, { timeout: TIMEOUT_MS }); break;
            case "canvas-click": await target.click({ position: { x: input.x! - observed.canvasBounds[input.controlId]!.x, y: input.y! - observed.canvasBounds[input.controlId]!.y }, timeout: TIMEOUT_MS }); break;
          }
          actionPerformed = true;
        } catch {
          message = "The action could not be confirmed. Inspect the new observation before deciding whether to retry.";
        }
        const verified = actionPerformed && Boolean(input.postcondition) && await verify(input.postcondition!);
        const observation = await capture([...Object.keys(observed.controls), ...(input.postcondition ? [input.postcondition.controlId] : [])]);
        return { status: verified ? "verified" : "unverified", actionPerformed, verification: verified ? "ui-postcondition" : "none", message: verified ? "The requested UI postcondition was observed. Geometry is not certified by this check." : message, observation };
      });
    },
  };
}
