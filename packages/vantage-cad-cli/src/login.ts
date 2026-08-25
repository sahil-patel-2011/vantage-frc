/**
 * `vantage-cad login` (the `cadcursor login` step): open a real Chromium window, let
 * the user sign into their own Onshape account — password, SSO, 2FA, whatever their
 * organisation requires — and capture the resulting session for later REST calls.
 *
 * Why a browser session at all: Onshape's annual API allowance is charged to API
 * keys and to OAuth from non-App-Store apps, while calls from "Onshape browser and
 * mobile clients" and the "API Explorer when using Onshape session authentication"
 * are not counted. https://onshape-public.github.io/docs/auth/limits/ (verified 2026-08-24)
 *
 * HOW "SIGNED IN" IS DETECTED — deliberately not DOM text, which changes with every
 * Onshape UI release:
 *   1. a navigation gate — the main frame has to land on an onshape.com host with a
 *      path under /documents (observed via frame-navigation events, not scraping);
 *   2. a state check — one GET to the documented /users/current endpoint issued
 *      through the BROWSER's own cookie jar, which has to return 200 with an `id`.
 *      https://onshape-public.github.io/docs/api-intro/ (verified 2026-08-24)
 * Only when both hold are cookies captured. The probe is a session call, so it costs
 * nothing against the annual allowance.
 *
 * Three exits besides success are real and all are handled: the user closes the
 * window, the deadline passes, or Playwright is not installed.
 *
 * A note the owner asked to keep visible rather than buried: Onshape's Terms of Use
 * prohibit using "any robot, spider, scraper or other automated means to access the
 * Service", and state that accessing the service by anything other than an unmodified
 * Onshape client also brings their API Agreement into scope. This flow drives the
 * user's own account, in their own browser, at their own instruction — but it is not
 * a documented or Onshape-blessed integration path, and that is a judgement for the
 * account owner to make, not something this code should imply away.
 */

import {
  normalizeOnshapeCookies,
  ONSHAPE_DEFAULT_BASE_URL,
  pickReplayableHeaders,
  saveOnshapeBrowserSession,
  type OnshapeBrowserSession,
} from "../../cad/src/onshape-session-store";

export const ONSHAPE_LOGIN_LANDING_PATH = "/documents";
/** Documented endpoint that returns the signed-in user's `id`. */
export const ONSHAPE_IDENTITY_PATH = "/api/v6/users/current";
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_LOGIN_POLL_MS = 1_500;

export type LoginApiResponse = { status: number; body: unknown };

/** The browser surface this flow needs. Injected, so tests never open a real window. */
export type LoginBrowserSession = {
  goto(url: string): Promise<void>;
  /** Latest main-frame URL. */
  currentUrl(): string;
  onNavigated(listener: (url: string) => void): void;
  onClosed(listener: () => void): void;
  /** GET through the browser's OWN cookie jar — proof the live session works. */
  apiGet(path: string): Promise<LoginApiResponse>;
  cookies(): Promise<readonly unknown[]>;
  /** CSRF-style headers seen on real web-client /api/ requests, if the client sent any. */
  observedHeaders(): Record<string, string>;
  close(): Promise<void>;
};

export type LoginLauncher = (options: { baseUrl: string; headless: boolean }) => Promise<LoginBrowserSession>;

export type OnshapeLoginResult =
  | {
      status: "signed-in";
      /** True when the window opened straight onto a working session — no sign-in needed. */
      alreadySignedIn: boolean;
      session: OnshapeBrowserSession;
      identity: { id: string; name?: string } | null;
      savedTo?: string;
      probes: number;
    }
  | { status: "cancelled"; message: string }
  | { status: "timeout"; message: string; waitedMs: number }
  | { status: "unavailable"; message: string };

export type RunOnshapeLoginOptions = {
  launch: LoginLauncher;
  baseUrl?: string;
  timeoutMs?: number;
  pollMs?: number;
  headless?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Injected in tests; defaults to the 0600 store under the user's home directory. */
  save?: (session: OnshapeBrowserSession) => Promise<string>;
};

const SIGN_IN_PATH = /\/(sign-?in|signin|login|oauth)/i;

function onshapeHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === "onshape.com" || lower.endsWith(".onshape.com");
}

/**
 * The navigation gate: an onshape.com host with a path under /documents. This is the
 * page a signed-in user lands on, and it is a URL fact, not page content.
 */
export function isOnshapeDocumentsLocation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!onshapeHost(parsed.hostname)) return false;
    return parsed.pathname === ONSHAPE_LOGIN_LANDING_PATH || parsed.pathname.startsWith(`${ONSHAPE_LOGIN_LANDING_PATH}/`);
  } catch {
    return false;
  }
}

export function isOnshapeSignInLocation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!onshapeHost(parsed.hostname)) return true; // an identity provider (SSO) counts as signing in
    return SIGN_IN_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Origin of the page the user actually ended up on — enterprise tenants are <company>.onshape.com. */
export function originFor(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    return onshapeHost(parsed.hostname) ? parsed.origin : fallback;
  } catch {
    return fallback;
  }
}

function identityFrom(body: unknown): { id: string; name?: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  if (!id) return null;
  return { id, ...(record.name ? { name: String(record.name) } : {}) };
}

export async function runOnshapeBrowserLogin(options: RunOnshapeLoginOptions): Promise<OnshapeLoginResult> {
  const baseUrl = (options.baseUrl ?? ONSHAPE_DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS);
  const pollMs = Math.max(100, options.pollMs ?? DEFAULT_LOGIN_POLL_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((line: string) => console.log(line));
  const save = options.save ?? ((session: OnshapeBrowserSession) => saveOnshapeBrowserSession(session));

  let browser: LoginBrowserSession;
  try {
    browser = await options.launch({ baseUrl, headless: options.headless ?? false });
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Could not open a browser window for Onshape sign-in.",
    };
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let closed = false;
  let sawSignIn = false;
  let location = baseUrl + ONSHAPE_LOGIN_LANDING_PATH;
  let probes = 0;

  browser.onClosed(() => {
    closed = true;
  });
  browser.onNavigated((url) => {
    location = url;
    if (isOnshapeSignInLocation(url)) sawSignIn = true;
  });

  try {
    await browser.goto(`${baseUrl}${ONSHAPE_LOGIN_LANDING_PATH}`);
    log("Sign into Onshape in the browser window. This terminal is waiting; nothing is typed for you.");

    for (;;) {
      if (closed) {
        return {
          status: "cancelled",
          message: "The browser window was closed before sign-in finished. No Onshape session was saved.",
        };
      }
      if (now() >= deadline) {
        return {
          status: "timeout",
          waitedMs: now() - startedAt,
          message: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Onshape sign-in. No session was saved — run \`vantage-cad login\` again.`,
        };
      }

      const current = location || browser.currentUrl();
      if (isOnshapeDocumentsLocation(current)) {
        probes += 1;
        const probe = await browser.apiGet(ONSHAPE_IDENTITY_PATH).catch(() => ({ status: 0, body: null }));
        const identity = probe.status === 200 ? identityFrom(probe.body) : null;
        if (identity) {
          const origin = originFor(current, baseUrl);
          const cookies = normalizeOnshapeCookies(await browser.cookies());
          if (cookies.length === 0) {
            return {
              status: "unavailable",
              message:
                "Onshape reported a signed-in user but the browser exposed no onshape.com cookies, so there is nothing to save. Sign in again in a normal (non-incognito) window.",
            };
          }
          const session: OnshapeBrowserSession = {
            version: 1,
            baseUrl: origin,
            cookies,
            headers: pickReplayableHeaders(browser.observedHeaders()),
            capturedAt: new Date(now()).toISOString(),
            ...(identity.name ? { accountLabel: identity.name } : {}),
          };
          const savedTo = await save(session);
          return {
            status: "signed-in",
            alreadySignedIn: probes === 1 && !sawSignIn,
            session,
            identity,
            ...(savedTo ? { savedTo } : {}),
            probes,
          };
        }
      }
      await sleep(pollMs);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function formatLoginResult(result: OnshapeLoginResult): string[] {
  if (result.status === "signed-in") {
    const who = result.identity?.name ?? result.identity?.id ?? "your Onshape account";
    return [
      result.alreadySignedIn
        ? `Already signed into Onshape as ${who}.`
        : `Signed into Onshape as ${who}.`,
      `Session saved to ${result.savedTo ?? "the local 0600 session file"} (${result.session.cookies.length} cookies, host ${result.session.baseUrl}).`,
      Object.keys(result.session.headers ?? {}).length
        ? `Captured ${Object.keys(result.session.headers ?? {}).length} CSRF-style header(s) from the live Onshape client.`
        : "No CSRF-style headers were sent by the Onshape client; none are replayed.",
      "Onshape does not count browser-session calls against your annual API allowance. `vantage-cad status` shows the split.",
    ];
  }
  if (result.status === "cancelled") return [result.message];
  if (result.status === "timeout") return [result.message];
  return [result.message];
}

// ---------------------------------------------------------------------------
// Real Chromium launcher (Playwright, already a dependency of this repo)
// ---------------------------------------------------------------------------

type PlaywrightRequest = { url(): string; headers(): Record<string, string> };
type PlaywrightFrame = { url(): string };
type PlaywrightPage = {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  mainFrame(): PlaywrightFrame;
  on(event: "framenavigated", listener: (frame: PlaywrightFrame) => void): void;
  on(event: "request", listener: (request: PlaywrightRequest) => void): void;
  on(event: "close", listener: () => void): void;
};
type PlaywrightApiResponse = { status(): number; json(): Promise<unknown> };
type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  cookies(): Promise<unknown[]>;
  request: { get(url: string, options?: { failOnStatusCode?: boolean }): Promise<PlaywrightApiResponse> };
};
type PlaywrightBrowser = {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
  on(event: "disconnected", listener: () => void): void;
};
type PlaywrightModule = {
  chromium: { launch(options?: { headless?: boolean; channel?: string }): Promise<PlaywrightBrowser> };
};

export const PLAYWRIGHT_MISSING_MESSAGE = [
  "Onshape browser sign-in needs Playwright's Chromium, which is not installed here.",
  "  npm install --save-dev playwright   (already a dependency in the Vantage monorepo)",
  "  npx playwright install chromium",
  "Then run `vantage-cad login` again. Without it, Onshape falls back to OAuth or API keys, and API-key calls are deducted from your annual allowance.",
].join("\n");

/**
 * Launch a visible Chromium and adapt it to LoginBrowserSession.
 *
 * The specifier is read from a variable so a missing Playwright install fails at
 * runtime with the message above instead of breaking the CLI bundle, and so a user
 * who only has `playwright-core` can point VANTAGE_CAD_PLAYWRIGHT at it.
 */
export function createChromiumLoginLauncher(env: NodeJS.ProcessEnv = process.env): LoginLauncher {
  return async ({ baseUrl, headless }) => {
    const specifier = (env.VANTAGE_CAD_PLAYWRIGHT ?? "playwright").trim() || "playwright";
    let playwright: PlaywrightModule;
    try {
      playwright = (await import(specifier)) as PlaywrightModule;
    } catch {
      throw new Error(PLAYWRIGHT_MISSING_MESSAGE);
    }

    const browser = await playwright.chromium.launch({ headless });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    const observed: Record<string, string> = {};
    const navigationListeners: Array<(url: string) => void> = [];
    const closeListeners: Array<() => void> = [];
    let lastUrl = baseUrl;

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      lastUrl = frame.url();
      for (const listener of navigationListeners) listener(lastUrl);
    });
    page.on("request", (request) => {
      if (!request.url().includes("/api/")) return;
      Object.assign(observed, pickReplayableHeaders(request.headers()));
    });
    page.on("close", () => {
      for (const listener of closeListeners) listener();
    });
    browser.on("disconnected", () => {
      for (const listener of closeListeners) listener();
    });

    return {
      async goto(url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      },
      currentUrl: () => lastUrl || page.url(),
      onNavigated: (listener) => navigationListeners.push(listener),
      onClosed: (listener) => closeListeners.push(listener),
      async apiGet(path) {
        const response = await context.request.get(new URL(path, lastUrl || baseUrl).toString(), {
          failOnStatusCode: false,
        });
        const body = await response.json().catch(() => null);
        return { status: response.status(), body };
      },
      cookies: () => context.cookies(),
      observedHeaders: () => ({ ...observed }),
      close: () => browser.close(),
    };
  };
}
