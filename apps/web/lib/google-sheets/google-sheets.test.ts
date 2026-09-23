import { describe, expect, it } from "vitest";
import { createMicrosoftOAuthState } from "../microsoft/oauth-state";
import {
  GoogleSheetsClient,
  buildGoogleAuthorizeUrl,
  describeGoogleError,
  googleErrorFromResponse,
  googleFetch,
  googleSheetsSetupStatus,
} from "./google-api";
import {
  createGoogleOAuthState,
  googlePkceChallenge,
  googlePkceVerifier,
  isGoogleSheetsState,
  verifyGoogleOAuthState,
} from "./oauth-state";
import { GoogleSheetsTarget, columnLetter, quoteSheet } from "./sheets-target";

const env = { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough", NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv;
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("Google OAuth for the mirror", () => {
  it("asks only for files Vantage creates, offline, with PKCE", () => {
    const url = new URL(
      buildGoogleAuthorizeUrl({ clientId: "id.apps.googleusercontent.com", clientSecret: "s", redirectUri: "https://x.test/cb" }, "st", "ch"),
    );
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("scope")).not.toContain("auth/spreadsheets");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/cb");
  });

  it("reports what is missing and the exact callback to register", () => {
    const status = googleSheetsSetupStatus({ BETTER_AUTH_URL: "https://vantagefrc.vercel.app/" } as unknown as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.missingEnv).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(status.callbackUrl).toBe("https://vantagefrc.vercel.app/api/integrations/google/callback");
  });

  it("on Vercel, uses the sign-in callback Google already accepts", () => {
    const prod = { VERCEL: "1", GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv;
    expect(googleSheetsSetupStatus(prod).callbackUrl).toBe("https://vantage-frc-web.vercel.app/api/auth/callback/google");
    expect(
      googleSheetsSetupStatus({ ...prod, GOOGLE_SHEETS_REDIRECT_URI: "https://x.test/api/integrations/google/callback" } as NodeJS.ProcessEnv)
        .callbackUrl,
    ).toBe("https://x.test/api/integrations/google/callback");
  });

  it("tells a Sheets callback from a sign-in callback by its state", () => {
    const state = createGoogleOAuthState({ orgId: "org", userId: "user" }, env, 1_000);
    expect(isGoogleSheetsState(state)).toBe(true);
    expect(isGoogleSheetsState(createMicrosoftOAuthState({ orgId: "o", userId: "u" }, env, 1_000))).toBe(false);
    // Better Auth's own states (random or encrypted) are not JSON with our purpose.
    expect(isGoogleSheetsState("Zm9vYmFy")).toBe(false);
    expect(isGoogleSheetsState(null)).toBe(false);
  });

  it("round-trips a signed state and derives a stable PKCE pair from it", () => {
    const state = createGoogleOAuthState({ orgId: "org", userId: "user" }, env, 1_000);
    const claims = verifyGoogleOAuthState(state, env, 2_000);
    expect(claims).toMatchObject({ orgId: "org", userId: "user" });
    const verifier = googlePkceVerifier(claims.nonce, env);
    expect(verifier).toBe(googlePkceVerifier(claims.nonce, env));
    expect(googlePkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a tampered, expired, or Microsoft state", () => {
    const state = createGoogleOAuthState({ orgId: "org", userId: "user" }, env, 1_000);
    const [body, sig] = state.split(".");
    expect(() => verifyGoogleOAuthState(`${body}.x${sig!.slice(1)}`, env, 2_000)).toThrow(/signature/);
    expect(() => verifyGoogleOAuthState(state, env, 1_000 + 16 * 60_000)).toThrow(/expired/);
    const microsoft = createMicrosoftOAuthState({ orgId: "org", userId: "user" }, env, 1_000);
    expect(() => verifyGoogleOAuthState(microsoft, env, 2_000)).toThrow();
  });
});

describe("Google errors", () => {
  it("names a disabled Sheets API rather than a vague failure", async () => {
    const error = await googleErrorFromResponse(
      jsonResponse(403, {
        error: { status: "PERMISSION_DENIED", message: "Google Sheets API has not been used in project 1 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] },
      }),
    );
    expect(error.kind).toBe("api_disabled");
    expect(describeGoogleError(error)).toMatch(/enable/i);
  });

  it("treats quota errors as throttling, with the wait Google asked for", async () => {
    const error = await googleErrorFromResponse(
      jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }, { "retry-after": "30" }),
    );
    expect(error.kind).toBe("throttled");
    expect(error.retryAfterMs).toBe(30_000);
  });

  it("treats a revoked refresh token as reconnect", async () => {
    const error = await googleErrorFromResponse(jsonResponse(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
    expect(error.kind).toBe("auth_expired");
  });

  it("retries a rate limit with backoff and gives up on the wait it cannot afford", async () => {
    let calls = 0;
    const slept: number[] = [];
    const response = await googleFetch(
      "https://sheets.test",
      {},
      {
        fetchImpl: async () => (++calls < 3 ? new Response("", { status: 429 }) : new Response("ok", { status: 200 })),
        sleep: async (ms) => {
          slept.push(ms);
        },
        random: () => 0.5,
      },
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
    expect(slept).toEqual([500, 1000]);

    const long = await googleFetch(
      "https://sheets.test",
      {},
      { fetchImpl: async () => new Response("", { status: 429, headers: { "retry-after": "600" } }), sleep: async () => undefined },
    );
    expect(long.status).toBe(429);
  });
});

describe("GoogleSheetsTarget", () => {
  it("quotes sheet names and letters columns like A1 notation", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(quoteSheet("Pick List's")).toBe("'Pick List''s'");
  });

  it("adds a missing sheet with a header, then replaces the body by clearing and writing", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const client = {
      async request(method: string, url: string, body?: unknown) {
        calls.push({ method, url: decodeURIComponent(url), body });
        if (method === "GET" && url.includes("fields=sheets")) return { sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] };
        if (url.endsWith(":batchUpdate") && JSON.stringify(body).includes("addSheet")) {
          return { replies: [{ addSheet: { properties: { sheetId: 7 } } }] };
        }
        return {};
      },
    } as unknown as GoogleSheetsClient;

    const target = await GoogleSheetsTarget.open(client, "sheet-123");
    const spec = { entity: "Teams" as const, sheet: "Teams", table: "VantageTeams", columns: ["id", "team_number"] };
    await target.ensureTable(spec);
    await target.replaceRows(spec, [
      ["frc254", 254],
      ["frc1678", null],
    ]);

    const writes = calls.filter((call) => call.method === "PUT");
    expect(writes[0]!.url).toContain("'Teams'!A1:B1");
    expect(writes[0]!.body).toEqual({ values: [["id", "team_number"]] });
    expect(writes[1]!.url).toContain("'Teams'!A2:B3");
    // Blanks are written as "", never null.
    expect(writes[1]!.body).toEqual({ values: [["frc254", 254], ["frc1678", ""]] });
    const clears = calls.filter((call) => call.url.endsWith("values:batchClear"));
    expect(clears.at(-1)!.body).toEqual({ ranges: ["'Teams'!A2:ZZZ"] });
  });

  it("reads a sheet back as headers and width-padded rows", async () => {
    const client = {
      async request(method: string, url: string) {
        if (url.includes("fields=sheets")) return { sheets: [{ properties: { sheetId: 3, title: "PickList" } }] };
        return { values: [["id", "rank", "notes"], ["a", 1], ["b", 2, "fast"]] };
      },
    } as unknown as GoogleSheetsClient;
    const target = await GoogleSheetsTarget.open(client, "s");
    const read = await target.readTable({ entity: "PickList", sheet: "PickList", table: "VantagePickList" });
    expect(read).toEqual({ headers: ["id", "rank", "notes"], rows: [["a", 1, ""], ["b", 2, "fast"]], truncated: false });
    expect(await target.readTable({ entity: "PitScouting", sheet: "PitScouting", table: "VantagePitScouting" })).toBeNull();
  });
});
