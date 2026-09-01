/**
 * Playwright-backed Onshape HTTP for the local CLI.
 *
 * Requests execute with `window.fetch` in a real Onshape page, so they use the
 * browser's own signed-in session. This is intentionally local-only: no cookies
 * leave the machine and the hosted web app never imports Playwright.
 */
import {
  classifyOnshapeResponse,
  onshapeApiUrl,
  OnshapeSessionExpiredError,
  type OnshapeHttpFn,
  type OnshapeSessionHttpOptions,
} from "../../cad/src/onshape-session";
import type { OnshapeBrowserSession } from "../../cad/src/onshape-session-store";
import { PLAYWRIGHT_MISSING_MESSAGE } from "./login";

type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type BrowserFetchInput = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

type BrowserFetchOutput = {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: Record<string, string>;
  bodyBase64: string;
};

type PlaywrightPage = {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  evaluate<TArg, TResult>(
    callback: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg,
  ): Promise<TResult>;
};

type PlaywrightContext = {
  addCookies(cookies: BrowserCookie[]): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightBrowser = {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
  on(event: "disconnected", listener: () => void): void;
};

type PlaywrightModule = {
  chromium: {
    launch(options?: { headless?: boolean; channel?: string }): Promise<PlaywrightBrowser>;
  };
};

type ActiveBrowser = {
  key: string;
  browser: PlaywrightBrowser;
  context: PlaywrightContext;
  page: PlaywrightPage;
};

export type PlaywrightOnshapeSessionManager = {
  sessionHttpFactory: (
    session: OnshapeBrowserSession,
    options: OnshapeSessionHttpOptions,
  ) => Promise<OnshapeHttpFn>;
  close(): Promise<void>;
};

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function requestBody(init: RequestInit): string | null {
  if (init.body == null) return null;
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof URLSearchParams) return init.body.toString();
  throw new Error("The Onshape browser transport only accepts string or URLSearchParams request bodies.");
}

function sessionKey(session: OnshapeBrowserSession): string {
  return `${session.baseUrl}|${session.capturedAt}|${session.cookies.length}`;
}

function responseFromBrowser(output: BrowserFetchOutput): Response {
  const body = Buffer.from(output.bodyBase64, "base64");
  const bodyAllowed = ![204, 205, 304].includes(output.status);
  return new Response(bodyAllowed ? body : null, {
    status: output.status,
    statusText: output.statusText,
    headers: output.headers,
  });
}

export function createPlaywrightOnshapeSessionManager(
  env: NodeJS.ProcessEnv = process.env,
  loadPlaywright?: (specifier: string) => Promise<PlaywrightModule>,
): PlaywrightOnshapeSessionManager {
  let active: ActiveBrowser | null = null;
  let opening: Promise<ActiveBrowser> | null = null;

  async function close(): Promise<void> {
    const current = active;
    active = null;
    opening = null;
    if (current) {
      await current.context.close().catch(() => undefined);
      await current.browser.close().catch(() => undefined);
    }
  }

  async function open(session: OnshapeBrowserSession): Promise<ActiveBrowser> {
    const key = sessionKey(session);
    if (active?.key === key) return active;
    if (opening) {
      const pending = await opening;
      if (pending.key === key) return pending;
      await close();
    } else if (active) {
      await close();
    }

    opening = (async () => {
      const specifier = (env.VANTAGE_CAD_PLAYWRIGHT ?? "playwright").trim() || "playwright";
      let playwright: PlaywrightModule;
      try {
        playwright = loadPlaywright
          ? await loadPlaywright(specifier)
          : ((await import(specifier)) as PlaywrightModule);
      } catch {
        throw new Error(PLAYWRIGHT_MISSING_MESSAGE);
      }

      const browser = await playwright.chromium.launch({
        headless: truthy(env.VANTAGE_CAD_BROWSER_HEADLESS),
      });
      const context = await browser.newContext({ baseURL: session.baseUrl });
      await context.addCookies(session.cookies.map((cookie) => ({ ...cookie })));
      const page = await context.newPage();
      await page.goto(`${session.baseUrl}/documents`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (!page.url().startsWith(`${session.baseUrl}/documents`)) {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        throw new OnshapeSessionExpiredError("the browser was redirected away from Onshape documents");
      }

      const opened = { key, browser, context, page };
      browser.on("disconnected", () => {
        if (active?.browser === browser) active = null;
      });
      active = opened;
      return opened;
    })();

    try {
      return await opening;
    } finally {
      opening = null;
    }
  }

  return {
    async sessionHttpFactory(session) {
      return async (path, init = {}) => {
        const current = await open(session);
        const url = onshapeApiUrl(session.baseUrl, path);
        const headers = Object.fromEntries(new Headers(init.headers).entries());
        for (const [name, value] of Object.entries(session.headers ?? {})) {
          if (!(name in headers)) headers[name] = value;
        }
        if (!("accept" in headers)) {
          headers.accept = "application/json;charset=UTF-8; qs=0.09";
        }
        if (init.body && !("content-type" in headers)) {
          headers["content-type"] = "application/json;charset=UTF-8; qs=0.09";
        }

        const output = await current.page.evaluate<BrowserFetchInput, BrowserFetchOutput>(
          async (request) => {
            const response = await window.fetch(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.body,
              credentials: "include",
              redirect: "follow",
            });
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = "";
            const chunkSize = 32_768;
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
            }
            return {
              status: response.status,
              statusText: response.statusText,
              url: response.url,
              redirected: response.redirected,
              headers: Object.fromEntries(response.headers.entries()),
              bodyBase64: window.btoa(binary),
            };
          },
          {
            url,
            method: String(init.method ?? "GET").toUpperCase(),
            headers,
            body: requestBody(init),
          },
        );

        const classification = classifyOnshapeResponse({
          status: output.status,
          ok: output.status >= 200 && output.status < 300,
          url: output.url,
          redirected: output.redirected,
          headers: { get: (name) => output.headers[name.toLowerCase()] ?? null },
        });
        if (classification === "expired") {
          await close();
          throw new OnshapeSessionExpiredError(
            `Onshape rejected the Playwright browser session with HTTP ${output.status}`,
            output.status,
          );
        }
        return responseFromBrowser(output);
      };
    },
    close,
  };
}
