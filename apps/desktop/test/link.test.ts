import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approvalUrlIsTrusted,
  cookieSetDetails,
  createChallenge,
  parseExchangeResponse,
  parsePollResponse,
  parseStartResponse,
  runLinkFlow,
  type FetchJson,
  type LinkState,
  type SessionCookiePayload,
} from "../src/link";

const ORIGIN = "https://vantage-frc-web.vercel.app";

function goodStart() {
  return {
    userCode: "ABCD-EFGH",
    pollToken: "p".repeat(43),
    verificationUri: `${ORIGIN}/desktop-link?code=ABCD-EFGH`,
    expiresIn: 600,
    interval: 3,
  };
}

const COOKIE_EXPIRES_AT = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function goodCookie(): SessionCookiePayload {
  return {
    name: "__Secure-better-auth.session_token",
    value: "token.sig%2Fabc",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expiresAt: COOKIE_EXPIRES_AT,
  };
}

describe("createChallenge", () => {
  it("keeps the verifier local and sends only its sha256", () => {
    const { verifier, challenge } = createChallenge();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("hex"));
    expect(createChallenge().verifier).not.toBe(verifier);
  });
});

describe("response parsing", () => {
  it("accepts a well-formed start response and rejects malformed ones", () => {
    expect(parseStartResponse(goodStart())).toEqual(goodStart());
    expect(parseStartResponse(null)).toBeNull();
    expect(parseStartResponse({ ...goodStart(), userCode: "nope" })).toBeNull();
    expect(parseStartResponse({ ...goodStart(), expiresIn: 999999 })).toBeNull();
    expect(parseStartResponse({ ...goodStart(), interval: 0 })).toBeNull();
    expect(parseStartResponse({ ...goodStart(), pollToken: "" })).toBeNull();
  });

  it("parses poll states and rejects junk", () => {
    expect(parsePollResponse({ status: "pending" })).toEqual({ status: "pending" });
    expect(parsePollResponse({ status: "expired" })).toEqual({ status: "expired" });
    expect(parsePollResponse({ status: "consumed" })).toEqual({ status: "consumed" });
    expect(parsePollResponse({ status: "approved", authCode: "a".repeat(43) })).toEqual({
      status: "approved",
      authCode: "a".repeat(43),
    });
    expect(parsePollResponse({ status: "approved" })).toBeNull();
    expect(parsePollResponse({ status: "approved", authCode: "bad code!" })).toBeNull();
    expect(parsePollResponse({ status: "???" })).toBeNull();
  });

  it("only accepts Better Auth session cookies", () => {
    expect(parseExchangeResponse({ cookie: goodCookie() })).toEqual({ cookie: goodCookie() });
    expect(parseExchangeResponse({ cookie: { ...goodCookie(), name: "evil-cookie" } })).toBeNull();
    expect(parseExchangeResponse({ cookie: { ...goodCookie(), value: "has spaces" } })).toBeNull();
    expect(parseExchangeResponse({ cookie: { ...goodCookie(), value: "semi;colon" } })).toBeNull();
    expect(parseExchangeResponse({ cookie: { ...goodCookie(), value: "" } })).toBeNull();
    expect(parseExchangeResponse({})).toBeNull();
  });
});

describe("approvalUrlIsTrusted", () => {
  it("accepts only the app origin's /desktop-link page", () => {
    expect(approvalUrlIsTrusted(`${ORIGIN}/desktop-link?code=ABCD-EFGH`, ORIGIN)).toBe(true);
    expect(approvalUrlIsTrusted(`${ORIGIN}/phishing`, ORIGIN)).toBe(false);
    expect(approvalUrlIsTrusted("https://evil.example/desktop-link", ORIGIN)).toBe(false);
    expect(approvalUrlIsTrusted("not a url", ORIGIN)).toBe(false);
  });
});

describe("cookieSetDetails", () => {
  it("targets the app origin and preserves attributes", () => {
    const details = cookieSetDetails(goodCookie(), ORIGIN);
    expect(details.url).toBe(`${ORIGIN}/`);
    expect(details.name).toBe("__Secure-better-auth.session_token");
    expect(details.secure).toBe(true);
    expect(details.httpOnly).toBe(true);
    expect(details.sameSite).toBe("lax");
    expect(details.expirationDate).toBeGreaterThan(Date.now() / 1000);
  });

  it("forces Secure for __Secure- names and https origins", () => {
    const insecure = { ...goodCookie(), secure: false };
    expect(cookieSetDetails(insecure, ORIGIN).secure).toBe(true);
    const devCookie = { ...goodCookie(), name: "better-auth.session_token", secure: false };
    expect(cookieSetDetails(devCookie, "http://localhost:3001").secure).toBe(false);
  });

  it("omits expirationDate when the server sent none", () => {
    expect(cookieSetDetails({ ...goodCookie(), expiresAt: null }, ORIGIN).expirationDate).toBeUndefined();
  });
});

type Call = { path: string; body: Record<string, unknown> };

function makeFetch(script: Array<{ status: number; json: unknown }>, calls: Call[]): FetchJson {
  let index = 0;
  return async (path, body) => {
    calls.push({ path, body: body as Record<string, unknown> });
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    return step;
  };
}

function collectDeps(fetchJson: FetchJson) {
  const states: LinkState[] = [];
  const opened: string[] = [];
  const installed: unknown[] = [];
  return {
    states,
    opened,
    installed,
    deps: {
      origin: ORIGIN,
      machineName: "SHOP-PC",
      desktopVersion: "0.1.0",
      fetchJson,
      openExternal: (url: string) => {
        opened.push(url);
      },
      installCookie: async (details: unknown) => {
        installed.push(details);
      },
      onState: (state: LinkState) => {
        states.push(state);
      },
      delay: async () => {},
    },
  };
}

describe("runLinkFlow", () => {
  it("start → waiting → approval → exchange → installs the session cookie", async () => {
    const calls: Call[] = [];
    const fetchJson = makeFetch(
      [
        { status: 200, json: goodStart() },
        { status: 200, json: { status: "pending" } },
        { status: 200, json: { status: "approved", authCode: "a".repeat(43) } },
        { status: 200, json: { cookie: goodCookie() } },
      ],
      calls,
    );
    const { states, opened, installed, deps } = collectDeps(fetchJson);

    const terminal = await runLinkFlow(deps);

    expect(terminal).toEqual({ phase: "success" });
    expect(states.map((s) => s.phase)).toEqual(["starting", "waiting", "exchanging", "success"]);
    expect(opened).toEqual([`${ORIGIN}/desktop-link?code=ABCD-EFGH`]);
    expect(installed).toHaveLength(1);

    // The verifier leaves the process exactly once: in the exchange body,
    // and its sha256 is what the start call carried.
    const startCall = calls[0]!;
    const exchangeCall = calls[3]!;
    expect(startCall.path).toBe("/api/desktop/link/start");
    expect(exchangeCall.path).toBe("/api/desktop/link/exchange");
    const verifier = exchangeCall.body.verifier as string;
    expect(startCall.body.challenge).toBe(createHash("sha256").update(verifier).digest("hex"));
    expect(JSON.stringify(startCall.body)).not.toContain(verifier);
  });

  it("reports an honest error when the code expires unapproved", async () => {
    const calls: Call[] = [];
    const fetchJson = makeFetch(
      [
        { status: 200, json: { ...goodStart(), expiresIn: 60 } },
        { status: 200, json: { status: "expired" } },
      ],
      calls,
    );
    const { states, installed, deps } = collectDeps(fetchJson);
    const terminal = await runLinkFlow(deps);
    expect(terminal.phase).toBe("error");
    expect((terminal as { message: string }).message).toMatch(/expired/i);
    expect(installed).toHaveLength(0);
    expect(states.at(-1)?.phase).toBe("error");
  });

  it("refuses to install a cookie that is not a Better Auth session cookie", async () => {
    const fetchJson = makeFetch(
      [
        { status: 200, json: goodStart() },
        { status: 200, json: { status: "approved", authCode: "a".repeat(43) } },
        { status: 200, json: { cookie: { ...goodCookie(), name: "tracking-cookie" } } },
      ],
      [],
    );
    const { installed, deps } = collectDeps(fetchJson);
    const terminal = await runLinkFlow(deps);
    expect(terminal.phase).toBe("error");
    expect(installed).toHaveLength(0);
  });

  it("refuses an approval URL that is not the app origin's /desktop-link", async () => {
    const fetchJson = makeFetch(
      [{ status: 200, json: { ...goodStart(), verificationUri: "https://evil.example/desktop-link" } }],
      [],
    );
    const { opened, deps } = collectDeps(fetchJson);
    const terminal = await runLinkFlow(deps);
    expect(terminal.phase).toBe("error");
    expect(opened).toHaveLength(0);
  });

  it("stops quietly when cancelled while waiting", async () => {
    let polls = 0;
    const fetchJson: FetchJson = async (path) => {
      if (path === "/api/desktop/link/start") return { status: 200, json: goodStart() };
      polls += 1;
      return { status: 200, json: { status: "pending" } };
    };
    const { deps } = collectDeps(fetchJson);
    let cancelled = false;
    const terminal = await runLinkFlow({
      ...deps,
      isCancelled: () => cancelled,
      delay: async () => {
        if (polls >= 1) cancelled = true;
      },
    });
    expect(terminal.phase).toBe("cancelled");
  });

  it("keeps waiting through transient poll failures", async () => {
    let calls = 0;
    const fetchJson: FetchJson = async (path) => {
      if (path === "/api/desktop/link/start") return { status: 200, json: goodStart() };
      if (path === "/api/desktop/link/poll") {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        if (calls === 2) return { status: 429, json: { error: "slow down" } };
        return { status: 200, json: { status: "approved", authCode: "a".repeat(43) } };
      }
      return { status: 200, json: { cookie: goodCookie() } };
    };
    const { deps, installed } = collectDeps(fetchJson);
    const terminal = await runLinkFlow(deps);
    expect(terminal.phase).toBe("success");
    expect(installed).toHaveLength(1);
  });
});
