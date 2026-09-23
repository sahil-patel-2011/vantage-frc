import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Runs public/sw.js in a sandbox with fake caches and fetch, then sends it the
 * WARM_ROUTES message the Scouting home's "Get this phone ready" posts.
 */
const SW_SOURCE = readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://vantagefrc-scouting.vercel.app";

type Stored = Map<string, Map<string, Response>>;

function harness(pages: Record<string, { html?: string; status?: number; redirected?: boolean }>) {
  const stores: Stored = new Map();
  const fetched: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const keyOf = (request: string | Request) => new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (request: string | Request) => store.get(keyOf(request)),
      put: async (request: string | Request, response: Response) => void store.set(keyOf(request), response),
      add: async () => undefined,
    };
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=test`),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const fakeFetch = async (input: string) => {
    const url = new URL(input, ORIGIN);
    fetched.push(url.pathname + url.search);
    if (url.pathname.startsWith("/_next/static/")) return new Response("/* asset */", { status: 200 });
    const page = pages[url.pathname];
    if (!page) return new Response("missing", { status: 404 });
    const response = new Response(page.html ?? "", { status: page.status ?? 200 });
    if (page.redirected) Object.defineProperty(response, "redirected", { value: true });
    return response;
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
    console,
  });

  async function warm(paths: unknown) {
    let reply: unknown = null;
    let done: Promise<unknown> = Promise.resolve();
    listeners.get("message")!({
      data: { type: "WARM_ROUTES", paths },
      ports: [{ postMessage: (value: unknown) => void (reply = value) }],
      waitUntil: (promise: Promise<unknown>) => void (done = promise),
    });
    await done;
    return reply as { pages: number; files: number };
  }
  return { warm, stores, fetched };
}

describe("service worker WARM_ROUTES", () => {
  it("stores each Scouting page under its path, with the scripts and styles it names", async () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js"></script><script src="/_next/static/chunks/main.js"></script>`;
    const { warm, stores } = harness({ "/scout": { html }, "/scout/entry": { html } });
    const result = await warm(["/scout?orgId=abc", "/scout/entry?orgId=abc"]);
    expect(result).toEqual({ pages: 2, files: 2 });
    const shell = [...stores.entries()].find(([name]) => name.startsWith("vantage-shell-"))![1];
    expect([...shell.keys()].sort()).toEqual([`${ORIGIN}/scout`, `${ORIGIN}/scout/entry`]);
    const assets = [...stores.entries()].find(([name]) => name.startsWith("vantage-assets-"))![1];
    expect([...assets.keys()].sort()).toEqual([`${ORIGIN}/_next/static/chunks/main.js`, `${ORIGIN}/_next/static/css/app.css`]);
  });

  it("refuses non-shell paths, other origins, and pages that redirected to sign-in", async () => {
    const { warm, fetched } = harness({
      "/admin": { html: "x" },
      "/scout": { html: "signin", redirected: true },
    });
    // /admin is not an offline shell route (the budget page, for one, is).
    const result = await warm(["/admin", "https://evil.example/scout", "/scout", 42, "scout"]);
    expect(result).toEqual({ pages: 0, files: 0 });
    expect(fetched).toEqual(["/scout"]);
  });

  it("caps a message at twenty paths", async () => {
    const { warm, fetched } = harness({});
    await warm(Array.from({ length: 40 }, () => "/scout"));
    expect(fetched).toHaveLength(20);
  });
});
