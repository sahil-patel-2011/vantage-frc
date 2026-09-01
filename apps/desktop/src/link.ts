import { createHash, randomBytes } from "node:crypto";
import { isSessionCookieName } from "./allowlist";

/**
 * Browser-link sign-in for the desktop shell.
 *
 * Sign-in never happens inside the Electron window: the shell generates a
 * verifier it keeps in memory, sends only its sha256 challenge to
 * /api/desktop/link/start, opens the user's REAL system browser on the
 * approval page, polls for a one-time authorization code, and exchanges
 * code + verifier for the Better Auth session cookie it installs into the
 * persisted partition. Google OAuth and the email codes run where they
 * already work — the user's own browser.
 *
 * This module is deliberately Electron-free: everything effectful (fetch,
 * opening the browser, writing the cookie) is injected, so the whole state
 * machine is unit-testable.
 */

export type LinkState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; userCode: string; verificationUri: string; expiresAt: number }
  | { phase: "exchanging" }
  | { phase: "success" }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

export type StartResponse = {
  userCode: string;
  pollToken: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type PollResponse =
  | { status: "pending" }
  | { status: "approved"; authCode: string }
  | { status: "expired" }
  | { status: "consumed" };

export type SessionCookiePayload = {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none" | null;
  expiresAt: string | null;
};

/** Verifier stays in this process's memory; only the sha256 challenge leaves it. */
export function createChallenge(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("hex") };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseStartResponse(json: unknown): StartResponse | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  const userCode = asString(data.userCode);
  const pollToken = asString(data.pollToken);
  const verificationUri = asString(data.verificationUri);
  const expiresIn = typeof data.expiresIn === "number" ? data.expiresIn : NaN;
  const interval = typeof data.interval === "number" ? data.interval : NaN;
  if (!userCode || !pollToken || !verificationUri) return null;
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode)) return null;
  if (!Number.isFinite(expiresIn) || expiresIn < 30 || expiresIn > 3600) return null;
  if (!Number.isFinite(interval) || interval < 1 || interval > 30) return null;
  return { userCode, pollToken, verificationUri, expiresIn, interval };
}

export function parsePollResponse(json: unknown): PollResponse | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  if (data.status === "pending") return { status: "pending" };
  if (data.status === "expired") return { status: "expired" };
  if (data.status === "consumed") return { status: "consumed" };
  if (data.status === "approved") {
    const authCode = asString(data.authCode);
    if (!authCode || !/^[A-Za-z0-9_-]{20,200}$/.test(authCode)) return null;
    return { status: "approved", authCode };
  }
  return null;
}

/**
 * Only a Better Auth session cookie with a sane value may be installed —
 * never an arbitrary cookie a compromised response might describe.
 */
export function parseExchangeResponse(json: unknown): { cookie: SessionCookiePayload } | null {
  if (!json || typeof json !== "object") return null;
  const cookie = (json as Record<string, unknown>).cookie;
  if (!cookie || typeof cookie !== "object") return null;
  const data = cookie as Record<string, unknown>;
  const name = asString(data.name);
  const value = asString(data.value);
  if (!name || !isSessionCookieName(name)) return null;
  // Cookie-octet safety: no separators, whitespace, or control characters.
  if (!value || value.length > 4096 || /[\s;,"\\]/.test(value) || /[^\x21-\x7e]/.test(value)) return null;
  const sameSiteRaw = data.sameSite;
  const sameSite = sameSiteRaw === "lax" || sameSiteRaw === "strict" || sameSiteRaw === "none" ? sameSiteRaw : null;
  const expiresAt = asString(data.expiresAt);
  return {
    cookie: {
      name,
      value,
      path: asString(data.path) ?? "/",
      secure: data.secure === true,
      httpOnly: data.httpOnly !== false,
      sameSite,
      expiresAt: expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) ? expiresAt : null,
    },
  };
}

/** The shell only ever opens the app origin's own /desktop-link approval page. */
export function approvalUrlIsTrusted(uri: string, origin: string): boolean {
  try {
    const url = new URL(uri);
    return url.origin === new URL(origin).origin && url.pathname === "/desktop-link";
  } catch {
    return false;
  }
}

export type CookieSetDetails = {
  url: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "no_restriction" | "unspecified";
  expirationDate?: number;
};

/** Electron cookies.set() details for installing the session cookie on the app origin. */
export function cookieSetDetails(cookie: SessionCookiePayload, origin: string): CookieSetDetails {
  const url = new URL(origin);
  // __Secure- names require the Secure attribute regardless of what came over the wire.
  const secure = cookie.secure || cookie.name.toLowerCase().startsWith("__secure-") || url.protocol === "https:";
  const sameSite =
    cookie.sameSite === "none" ? "no_restriction" : cookie.sameSite === "strict" ? "strict" : "lax";
  const details: CookieSetDetails = {
    url: `${url.origin}/`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure,
    httpOnly: cookie.httpOnly,
    sameSite,
  };
  if (cookie.expiresAt) {
    const expires = new Date(cookie.expiresAt).getTime();
    if (Number.isFinite(expires) && expires > Date.now()) {
      details.expirationDate = Math.floor(expires / 1000);
    }
  }
  return details;
}

export type FetchJson = (path: string, body: unknown) => Promise<{ status: number; json: unknown }>;

export type LinkFlowDeps = {
  origin: string;
  machineName: string;
  desktopVersion: string;
  fetchJson: FetchJson;
  openExternal: (url: string) => void | Promise<void>;
  installCookie: (details: CookieSetDetails) => Promise<void>;
  onState: (state: LinkState) => void;
  delay: (ms: number) => Promise<void>;
  now?: () => number;
  isCancelled?: () => boolean;
};

/**
 * Drive one sign-in attempt start → waiting → exchange → cookie install.
 * Returns (and reports via onState) the terminal state. Never throws, never
 * logs, and never exposes the verifier, poll token, or authorization code
 * outside the exchange request body.
 */
export async function runLinkFlow(deps: LinkFlowDeps): Promise<LinkState> {
  const now = deps.now ?? Date.now;
  const cancelled = deps.isCancelled ?? (() => false);
  const finish = (state: LinkState): LinkState => {
    deps.onState(state);
    return state;
  };

  deps.onState({ phase: "starting" });
  const { verifier, challenge } = createChallenge();

  let start: StartResponse | "rate-limited" | null;
  try {
    const response = await deps.fetchJson("/api/desktop/link/start", {
      machineName: deps.machineName,
      challenge,
      desktopVersion: deps.desktopVersion,
    });
    start =
      response.status === 429
        ? "rate-limited"
        : response.status === 200
          ? parseStartResponse(response.json)
          : null;
  } catch {
    start = null;
  }
  if (start === "rate-limited") {
    return finish({ phase: "error", message: "Too many sign-in attempts. Wait a minute and try again." });
  }
  if (!start) {
    return finish({ phase: "error", message: "Vantage could not be reached. Check your connection and try again." });
  }
  if (!approvalUrlIsTrusted(start.verificationUri, deps.origin)) {
    return finish({ phase: "error", message: "The sign-in service answered unexpectedly. Try again later." });
  }

  const expiresAt = now() + start.expiresIn * 1000;
  deps.onState({ phase: "waiting", userCode: start.userCode, verificationUri: start.verificationUri, expiresAt });
  await deps.openExternal(start.verificationUri);

  let authCode: string | null = null;
  while (now() < expiresAt) {
    await deps.delay(start.interval * 1000);
    if (cancelled()) return finish({ phase: "cancelled" });
    let poll: PollResponse | null;
    try {
      const response = await deps.fetchJson("/api/desktop/link/poll", { pollToken: start.pollToken });
      if (response.status === 429) continue; // server asked us to slow down; next tick retries
      poll = parsePollResponse(response.json);
    } catch {
      continue; // transient network failure — keep waiting until the code expires
    }
    if (!poll) continue;
    if (poll.status === "pending") continue;
    if (poll.status === "expired") {
      return finish({ phase: "error", message: "The code expired before it was approved. Start again." });
    }
    if (poll.status === "consumed") {
      return finish({ phase: "error", message: "This code was already used. Start again to get a new one." });
    }
    authCode = poll.authCode;
    break;
  }
  if (cancelled()) return finish({ phase: "cancelled" });
  if (!authCode) {
    return finish({ phase: "error", message: "The code expired before it was approved. Start again." });
  }

  deps.onState({ phase: "exchanging" });
  let exchange: { cookie: SessionCookiePayload } | null = null;
  try {
    const response = await deps.fetchJson("/api/desktop/link/exchange", { authCode, verifier });
    exchange = response.status === 200 ? parseExchangeResponse(response.json) : null;
  } catch {
    // A transient/invalid exchange is handled by the null check below.
  }
  if (!exchange) {
    return finish({ phase: "error", message: "Sign-in could not be completed. Start again." });
  }

  try {
    await deps.installCookie(cookieSetDetails(exchange.cookie, deps.origin));
  } catch {
    return finish({ phase: "error", message: "The session could not be saved on this computer. Try again." });
  }
  return finish({ phase: "success" });
}
