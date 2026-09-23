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
import { GoogleSheetsTarget, columnLetter, planValueWrites, quoteSheet } from "./sheets-target";

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

  it("retries a server error with backoff", async () => {
    let calls = 0;
    const slept: number[] = [];
    const response = await googleFetch(
      "https://sheets.test",
      {},
      {
        fetchImpl: async () => (++calls < 3 ? new Response("", { status: 503 }) : new Response("ok", { status: 200 })),
        sleep: async (ms) => {
          slept.push(ms);
        },
        random: () => 0.5,
      },
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
    expect(slept).toEqual([500, 1000]);
  });

  it("never retries a 429: a request over quota is the one Google may bill", async () => {
    let calls = 0;
    const response = await googleFetch(
      "https://sheets.test",
      {},
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response("", { status: 429 });
        },
        sleep: async () => undefined,
      },
    );
    expect(response.status).toBe(429);
    expect(calls).toBe(1);
  });
});

describe("GoogleSheetsTarget", () => {
  it("quotes sheet names and letters columns like A1 notation", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(quoteSheet("Pick List's")).toBe("'Pick List''s'");
  });

  type StructureRequest = {
    addSheet?: { properties: { title: string } };
    updateSheetProperties?: { properties: { sheetId: number; gridProperties: { rowCount: number; columnCount: number } } };
    repeatCell?: unknown;
  };
  type SentBody = { ranges?: string[]; data?: Array<{ range: string; values: unknown[][] }>; requests?: StructureRequest[] };

  // A fake Sheets API that records every request, answering like Google does.
  function fakeSheets(existing: Array<{ title: string; sheetId: number; rows?: number; columns?: number }>, values: unknown[][][] = []) {
    const calls: Array<{ method: string; url: string; body: SentBody }> = [];
    const client = {
      async request(method: string, url: string, body?: unknown) {
        calls.push({ method, url: decodeURIComponent(url), body: (body ?? {}) as SentBody });
        if (method === "GET" && url.includes("fields=sheets")) {
          return {
            sheets: existing.map((sheet) => ({
              properties: {
                sheetId: sheet.sheetId,
                title: sheet.title,
                gridProperties: { rowCount: sheet.rows ?? 1000, columnCount: sheet.columns ?? 26 },
              },
            })),
          };
        }
        if (url.includes("values:batchGet")) return { valueRanges: values.map((v) => ({ values: v })) };
        return {};
      },
    } as unknown as GoogleSheetsClient;
    return { client, calls };
  }

  const workbook = () => {
    const spec = (sheet: string, columns: string[]) => ({ entity: sheet as "Teams", sheet, table: `Vantage${sheet}`, columns });
    return [
      { spec: spec("Teams", ["id", "team_number", "nickname"]), rows: [["frc254", 254, "Cheesy Poofs"], ["frc1678", null, "Citrus"]] },
      { spec: spec("Matches", ["id", "red", "blue"]), rows: Array.from({ length: 120 }, (_, i) => [`qm${i}`, "a", "b"]) },
      {
        spec: spec("MatchScouting", Array.from({ length: 30 }, (_, i) => `c${i}`)),
        rows: Array.from({ length: 3_000 }, (_, i) => Array.from({ length: 30 }, (_, j) => i * j)),
      },
      { spec: spec("PitScouting", ["id"]), rows: [] },
      { spec: spec("PickList", ["id", "rank"]), rows: [["a", 1]] },
      { spec: spec("SyncInfo", ["key", "value"]), rows: [["synced_at", "now"]] },
    ];
  };

  const sync = async (target: GoogleSheetsTarget) => {
    for (const table of workbook()) {
      await target.ensureTable(table.spec);
      await target.replaceRows(table.spec, table.rows);
    }
    await target.flush();
  };

  it("syncs a whole workbook in 1 read and 2 writes once the sheets exist", async () => {
    const titles = ["Teams", "Matches", "MatchScouting", "PitScouting", "PickList", "SyncInfo"];
    const { client, calls } = fakeSheets(titles.map((title, i) => ({ title, sheetId: i + 1, rows: 5_000, columns: 40 })));
    await sync(await GoogleSheetsTarget.open(client, "sheet-123"));
    expect(calls.map((call) => `${call.method} ${call.url.split("/").pop()!.split("?")[0]}`)).toEqual([
      "GET sheet-123",
      "POST values:batchClear",
      "POST values:batchUpdate",
    ]);
    expect(calls[1]!.body.ranges).toEqual(titles.map((title) => `'${title}'`));
    const data = calls[2]!.body.data ?? [];
    // Header in row 1, rows from row 2; blanks written as "", never null.
    expect(data[0]).toEqual({
      range: "'Teams'!A1:C3",
      values: [["id", "team_number", "nickname"], ["frc254", 254, "Cheesy Poofs"], ["frc1678", "", "Citrus"]],
    });
    expect(data.find((item) => item.range.startsWith("'MatchScouting'"))!.range).toBe("'MatchScouting'!A1:AD3001");
  });

  it("adds missing sheets and grows grids that are too small, in one structural write", async () => {
    const { client, calls } = fakeSheets([
      { title: "Sheet1", sheetId: 0 },
      { title: "MatchScouting", sheetId: 9, rows: 1_000, columns: 26 },
    ]);
    await sync(await GoogleSheetsTarget.open(client, "s"));
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(3);
    const structure = calls[1]!.body.requests ?? [];
    const added = structure.flatMap((request) => (request.addSheet ? [request.addSheet.properties.title] : []));
    expect(added).toEqual(["Teams", "Matches", "PitScouting", "PickList", "SyncInfo"]);
    // A new sheet starts at 1000 x 26 unless told otherwise; the data must fit.
    const grow = structure.find((request) => request.updateSheetProperties)!.updateSheetProperties;
    expect(grow.properties.sheetId).toBe(9);
    expect(grow.properties.gridProperties.rowCount).toBeGreaterThanOrEqual(3_001);
    expect(grow.properties.gridProperties.columnCount).toBeGreaterThanOrEqual(30);
    expect(structure.filter((request) => request.repeatCell)).toHaveLength(5);
  });

  it("splits a write only when it would carry too many cells", () => {
    const tables = workbook();
    expect(planValueWrites(tables)).toHaveLength(1);
    const small = planValueWrites(tables, 10_000);
    expect(small.length).toBeGreaterThan(1);
    for (const request of small) {
      const cells = request.reduce((sum, item) => sum + item.values.length * item.values[0]!.length, 0);
      expect(cells).toBeLessThanOrEqual(10_000);
    }
    // Split tables keep contiguous A1 ranges.
    const ranges = small.flat().filter((item) => item.range.startsWith("'MatchScouting'")).map((item) => item.range);
    expect(ranges[0]).toBe("'MatchScouting'!A1:AD333");
    expect(ranges[1]).toBe("'MatchScouting'!A334:AD666");
  });

  it("reads every import table in one request, padded to the header width", async () => {
    const { client, calls } = fakeSheets(
      [
        { title: "PickList", sheetId: 3 },
        { title: "MatchScouting", sheetId: 4 },
      ],
      [[["id", "rank", "notes"], ["a", 1], ["b", 2, "fast"]], [["id"], ["m1"]]],
    );
    const target = await GoogleSheetsTarget.open(client, "s");
    const pick = await target.readTable({ entity: "PickList", sheet: "PickList", table: "VantagePickList" });
    const match = await target.readTable({ entity: "MatchScouting", sheet: "MatchScouting", table: "VantageMatchScouting" });
    expect(pick).toEqual({ headers: ["id", "rank", "notes"], rows: [["a", 1, ""], ["b", 2, "fast"]], truncated: false });
    expect(match?.rows).toEqual([["m1"]]);
    expect(await target.readTable({ entity: "PitScouting", sheet: "PitScouting", table: "VantagePitScouting" })).toBeNull();
    expect(calls.filter((call) => call.url.includes("values:batchGet"))).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});
