import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Runs public/sw.js in a sandbox and sends it page navigations. The offline page is for a
 * failed network only — a slow page, or a navigation the browser cancelled, must never get it.
 */
const SW_SOURCE = readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://vantagefrc-scouting.vercel.app";
const OFFLINE_HTML = "<!doctype html><title>Offline</title>cached offline page";

type FetchPlan = (url: string, attempt: number) => Promise<Response>;

function harness(plan: FetchPlan, options: { online?: boolean } = {}) {
  const stores = new Map<string, Map<string, Response>>();
  const attempts = new Map<string, number>();
  const listeners = new Map<string, (event: unknown) => void>();
  const keyOf = (request: string | Request) => new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    if (name.startsWith("vantage-shell-") && !store.size) store.set(`${ORIGIN}/offline`, new Response(OFFLINE_HTML));
    return {
      match: async (request: string | Request) => store.get(keyOf(request))?.clone(),
      put: async (request: string | Request, response: Response) => {
        await response.clone().text();
        store.set(keyOf(request), response);
      },
      add: async () => undefined,
    };
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=test`),
    navigator: { onLine: options.online ?? true },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const fakeFetch = async (input: string | Request) => {
    const url = keyOf(input);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    return plan(url, attempt);
  };
  runInNewContext(SW_SOURCE, {
    self,
    caches: { open: async (name: string) => cacheFor(name), keys: async () => [], delete: async () => true },
    fetch: fakeFetch,
    URL,
    Request,
    Response,
    Set,
    Map,
    Promise,
    Array,
    Boolean,
    console,
  });

  async function navigate(path: string, signal?: AbortSignal) {
    const request = new Request(`${ORIGIN}${path}`, { signal });
    Object.defineProperty(request, "mode", { value: "navigate" });
    let responded: Promise<Response> | null = null;
    const background: Array<Promise<unknown>> = [];
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => void (responded = value),
      waitUntil: (value: Promise<unknown>) => void background.push(value),
    });
    const response = await responded!;
    await Promise.all(background);
    return response;
  }
  return { navigate, attempts, stores };
}

const page = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const networkError = () => Promise.reject(new TypeError("Failed to fetch"));

describe("service worker navigations", () => {
  it("waits for a slow page instead of showing the offline page", async () => {
    const { navigate } = harness(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return page("learn page");
    });
    expect(await (await navigate("/learn?tab=cad")).text()).toBe("learn page");
  });

  it("retries one dropped connection while the device is online", async () => {
    const { navigate, attempts } = harness((url, attempt) => (attempt === 1 ? networkError() : Promise.resolve(page(`ok ${url}`))));
    expect(await (await navigate("/learn")).text()).toBe(`ok ${ORIGIN}/learn`);
    expect(attempts.get(`${ORIGIN}/learn`)).toBe(2);
  });

  it("shows the offline page only when the network really fails", async () => {
    const online = harness(() => networkError());
    expect(await (await online.navigate("/learn")).text()).toBe(OFFLINE_HTML);
    const offline = harness(() => networkError(), { online: false });
    expect(await (await offline.navigate("/learn")).text()).toBe(OFFLINE_HTML);
    // No signal: no pointless retry.
    expect(offline.attempts.get(`${ORIGIN}/learn`)).toBe(1);
  });

  it("does not answer a cancelled navigation with the offline page", async () => {
    const controller = new AbortController();
    controller.abort();
    const { navigate } = harness(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    const response = await navigate("/learn", controller.signal);
    expect(response.type).toBe("error");
  });

  it("returns a shell page as soon as it arrives and caches it in the background", async () => {
    const { navigate, stores } = harness(() => Promise.resolve(page("scout page")));
    expect(await (await navigate("/scout")).text()).toBe("scout page");
    const shell = [...stores.entries()].find(([name]) => name.startsWith("vantage-shell-"))![1];
    expect(shell.has(`${ORIGIN}/scout`)).toBe(true);
  });

  it("keeps the self-contained fallback styled and honest", () => {
    expect(SW_SOURCE).toMatch(/<style>/);
    expect(SW_SOURCE).toMatch(/Couldn't load this page/);
    // No navigation timeout race anywhere in the worker.
    expect(SW_SOURCE).not.toMatch(/AbortSignal\.timeout|setTimeout/);
  });
});
