import { describe, expect, it } from "vitest";
import {
  formatLoginResult,
  isOnshapeDocumentsLocation,
  isOnshapeSignInLocation,
  ONSHAPE_IDENTITY_PATH,
  originFor,
  PLAYWRIGHT_MISSING_MESSAGE,
  runOnshapeBrowserLogin,
  type LoginApiResponse,
  type LoginBrowserSession,
} from "../src/login";
import type { OnshapeBrowserSession } from "../../cad/src/onshape-session-store";

const AUTH_COOKIE = {
  name: "onshape_auth",
  value: "cookie-value",
  domain: ".onshape.com",
  path: "/",
  expires: 4_102_444_800,
  httpOnly: true,
  secure: true,
};

/**
 * A scripted browser. `script` is the list of main-frame URLs the "user" walks
 * through — one per poll tick — and the identity probe answers 200 only after
 * `signedInAfter` probes, which models a slow SSO round-trip without a real window.
 */
function fakeBrowser(options: {
  script: string[];
  signedInAfter?: number;
  cookies?: unknown[];
  headers?: Record<string, string>;
  /** Close the window once this many ticks have happened. */
  closeAfter?: number;
  identity?: unknown;
}): { browser: LoginBrowserSession; tick: () => void; probes: () => number } {
  const navigationListeners: Array<(url: string) => void> = [];
  const closeListeners: Array<() => void> = [];
  let step = 0;
  let ticks = 0;
  let probes = 0;
  let closed = false;

  const emit = () => {
    const url = options.script[Math.min(step, options.script.length - 1)];
    step += 1;
    if (url) for (const listener of navigationListeners) listener(url);
  };

  const tick = () => {
    ticks += 1;
    if (options.closeAfter !== undefined && ticks >= options.closeAfter && !closed) {
      closed = true;
      for (const listener of closeListeners) listener();
      return;
    }
    emit();
  };

  const browser: LoginBrowserSession = {
    async goto() {
      emit();
    },
    currentUrl: () => options.script[Math.max(0, Math.min(step - 1, options.script.length - 1))] ?? "",
    onNavigated: (listener) => navigationListeners.push(listener),
    onClosed: (listener) => closeListeners.push(listener),
    async apiGet(path): Promise<LoginApiResponse> {
      expect(path).toBe(ONSHAPE_IDENTITY_PATH);
      probes += 1;
      const ready = probes > (options.signedInAfter ?? 0);
      return ready
        ? { status: 200, body: options.identity ?? { id: "u-1", name: "Team 254" } }
        : { status: 401, body: { message: "Unauthorized" } };
    },
    cookies: async () => options.cookies ?? [AUTH_COOKIE],
    observedHeaders: () => options.headers ?? {},
    async close() {
      closed = true;
    },
  };

  return { browser, tick, probes: () => probes };
}

function harness(
  overrides: Partial<Parameters<typeof runOnshapeBrowserLogin>[0]> = {},
  tick: () => void = () => undefined,
) {
  let clock = Date.UTC(2026, 7, 24, 12, 0, 0);
  const saved: OnshapeBrowserSession[] = [];
  return {
    saved,
    options: {
      timeoutMs: 60_000,
      pollMs: 1_000,
      now: () => clock,
      // Advancing the clock inside sleep keeps the deadline honest without real waiting,
      // and drives the scripted browser one step forward per poll.
      sleep: async (ms: number) => {
        clock += ms;
        tick();
      },
      log: () => undefined,
      save: async (session: OnshapeBrowserSession) => {
        saved.push(session);
        return "/tmp/onshape-session.json";
      },
      ...overrides,
    },
  };
}

describe("sign-in detection gates", () => {
  it("accepts only an onshape.com documents URL as the landing state", () => {
    expect(isOnshapeDocumentsLocation("https://cad.onshape.com/documents")).toBe(true);
    expect(isOnshapeDocumentsLocation("https://acme.onshape.com/documents/abc/w/x/e/y")).toBe(true);
    expect(isOnshapeDocumentsLocation("https://cad.onshape.com/signin")).toBe(false);
    expect(isOnshapeDocumentsLocation("https://onshape.com.evil.test/documents")).toBe(false);
    expect(isOnshapeDocumentsLocation("not a url")).toBe(false);
  });

  it("treats sign-in pages and third-party identity providers as not-yet-signed-in", () => {
    expect(isOnshapeSignInLocation("https://cad.onshape.com/signin")).toBe(true);
    expect(isOnshapeSignInLocation("https://login.microsoftonline.com/common/oauth2/authorize")).toBe(true);
    expect(isOnshapeSignInLocation("https://cad.onshape.com/documents")).toBe(false);
  });

  it("keeps the enterprise origin the user actually landed on", () => {
    expect(originFor("https://acme.onshape.com/documents", "https://cad.onshape.com")).toBe("https://acme.onshape.com");
    expect(originFor("https://evil.test/documents", "https://cad.onshape.com")).toBe("https://cad.onshape.com");
  });
});

describe("browser login flow", () => {
  it("captures the session after a sign-in redirect chain", async () => {
    const fake = fakeBrowser({
      script: [
        "https://cad.onshape.com/signin",
        "https://login.microsoftonline.com/common/oauth2/authorize",
        "https://cad.onshape.com/documents",
        "https://cad.onshape.com/documents",
      ],
      signedInAfter: 1,
      headers: { "x-xsrf-token": "abc", "user-agent": "Chromium" },
    });
    const { options, saved } = harness({}, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });

    expect(result.status).toBe("signed-in");
    if (result.status !== "signed-in") return;
    expect(result.alreadySignedIn).toBe(false);
    expect(result.identity).toEqual({ id: "u-1", name: "Team 254" });
    expect(result.session.cookies).toHaveLength(1);
    expect(result.session.baseUrl).toBe("https://cad.onshape.com");
    // Only CSRF-style headers survive the capture.
    expect(result.session.headers).toEqual({ "x-xsrf-token": "abc" });
    expect(saved).toHaveLength(1);
    expect(fake.probes()).toBeGreaterThan(1);
    expect(formatLoginResult(result).join("\n")).toMatch(/annual API allowance/i);
  });

  it("reports an already-signed-in account without asking for credentials", async () => {
    const fake = fakeBrowser({ script: ["https://cad.onshape.com/documents"] });
    const { options } = harness({}, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status).toBe("signed-in");
    if (result.status !== "signed-in") return;
    expect(result.alreadySignedIn).toBe(true);
    expect(result.probes).toBe(1);
    expect(formatLoginResult(result)[0]).toMatch(/Already signed into Onshape/);
  });

  it("keeps the enterprise host the user signed into", async () => {
    const fake = fakeBrowser({
      script: ["https://acme.onshape.com/documents"],
      cookies: [{ ...AUTH_COOKIE, domain: ".onshape.com" }],
    });
    const { options } = harness({}, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status === "signed-in" && result.session.baseUrl).toBe("https://acme.onshape.com");
  });

  it("returns cancelled when the user closes the window, and saves nothing", async () => {
    const fake = fakeBrowser({
      script: ["https://cad.onshape.com/signin", "https://cad.onshape.com/signin"],
      signedInAfter: 99,
      closeAfter: 1,
    });
    const { options, saved } = harness({}, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status).toBe("cancelled");
    expect(result.status === "cancelled" && result.message).toMatch(/closed before sign-in/i);
    expect(saved).toEqual([]);
  });

  it("times out with an actionable message instead of hanging", async () => {
    const fake = fakeBrowser({ script: ["https://cad.onshape.com/signin"], signedInAfter: 99 });
    const { options, saved } = harness({ timeoutMs: 5_000, pollMs: 1_000 }, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status).toBe("timeout");
    expect(result.status === "timeout" && result.message).toMatch(/vantage-cad login/);
    expect(saved).toEqual([]);
  });

  it("refuses to claim success when the browser exposed no Onshape cookies", async () => {
    const fake = fakeBrowser({
      script: ["https://cad.onshape.com/documents"],
      cookies: [{ name: "ga", value: "1", domain: ".google.com", path: "/" }],
    });
    const { options, saved } = harness({}, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.message).toMatch(/no onshape\.com cookies/i);
    expect(saved).toEqual([]);
  });

  it("surfaces a missing Playwright install as an instruction, not a stack trace", async () => {
    const { options } = harness();
    const result = await runOnshapeBrowserLogin({
      ...options,
      launch: async () => {
        throw new Error(PLAYWRIGHT_MISSING_MESSAGE);
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.message).toMatch(/npx playwright install chromium/);
  });

  it("does not accept a 200 identity response without an id", async () => {
    const fake = fakeBrowser({
      script: ["https://cad.onshape.com/documents"],
      identity: { name: "no id here" },
    });
    const { options } = harness({ timeoutMs: 4_000, pollMs: 1_000 }, fake.tick);
    const result = await runOnshapeBrowserLogin({ ...options, launch: async () => fake.browser });
    expect(result.status).toBe("timeout");
  });
});
