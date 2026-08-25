/**
 * Onshape call ledger — what makes the "session REST is free, API keys are not"
 * architecture verifiable instead of aspirational.
 *
 * Onshape publishes an ANNUAL (not per-minute) cap on API calls, pooled per company:
 *   Enterprise / Enterprise GOV   10,000 per full user
 *   Professional                   5,000 per user
 *   EDU Student / Free / Standard  2,500 per user
 *   EDU Enterprise                10,000 per enterprise
 *   EDU Educator / Pro Discovery   2,500 per company
 * Source (verified 2026-08-24): https://onshape-public.github.io/docs/auth/limits/
 *
 * The same page states which calls are counted and which are not. Counted:
 * API keys, OAuth2 through *private* (non-App-Store) applications, and the API
 * Explorer when authenticated by keys/OAuth. NOT counted: App Store apps over
 * OAuth2, "Onshape browser and mobile clients", "API Explorer when using Onshape
 * session authentication", webhooks, and any request that returns 4xx or 5xx
 * ("Calls from the following sources are only counted if they return 2xx or 3xx
 * Response Codes").
 *
 * Two consequences encoded below:
 *  - a session-authenticated call is charged 0 against the annual cap;
 *  - a failed key/OAuth call is charged 0 as well, so the ledger must see the
 *    status code before it can score a call.
 *
 * Vantage's OAuth client is not an App Store listing, so OAuth is scored as
 * counted. That is the conservative direction: over-reporting the cap spend is
 * safe, under-reporting it is what silently burns a team's year.
 */

export type OnshapeAuthPath = "session" | "oauth" | "api-key";

export const ONSHAPE_AUTH_PATHS: readonly OnshapeAuthPath[] = ["session", "oauth", "api-key"];

/** Published annual caps, by Onshape plan. Verified at the limits URL above. */
export const ONSHAPE_ANNUAL_CALL_LIMITS: Readonly<Record<string, number>> = {
  enterprise: 10_000,
  professional: 5_000,
  standard: 2_500,
  free: 2_500,
  edu_student: 2_500,
  edu_enterprise: 10_000,
  edu_educator: 2_500,
};

export type CallBudgetEntry = {
  at: string;
  authPath: OnshapeAuthPath;
  method: string;
  /** Request path with the query string stripped — never a URL that could carry a token. */
  path: string;
  status: number;
  ok: boolean;
  /** True only when Onshape's published rules charge this call to the annual cap. */
  countsAgainstAnnualCap: boolean;
  durationMs: number;
};

export type CallBudgetSummary = {
  total: number;
  byAuthPath: Record<OnshapeAuthPath, number>;
  /** Calls that Onshape will actually deduct from the annual allowance. */
  annualCapCalls: number;
  /** e.g. "8 session calls, 0 API-key calls". Safe to print verbatim. */
  headline: string;
  warnings: string[];
  entries: CallBudgetEntry[];
};

export type AttributedHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type CallBudget = {
  record(entry: Omit<CallBudgetEntry, "at" | "countsAgainstAnnualCap"> & { at?: string }): CallBudgetEntry;
  /** Wrap an Onshape http function so every call it serves is attributed and scored. */
  attribute(http: AttributedHttp, authPath: OnshapeAuthPath): AttributedHttp;
  summary(): CallBudgetSummary;
  reset(): void;
};

/**
 * Onshape only charges 2xx/3xx responses, and only on the key/OAuth paths.
 * Kept as a standalone pure function so the rule is testable without a request.
 */
export function countsAgainstAnnualCap(authPath: OnshapeAuthPath, status: number): boolean {
  if (authPath === "session") return false;
  return status >= 200 && status < 400;
}

/** Strip query strings and any absolute origin so the ledger never stores a token. */
export function ledgerPath(pathOrUrl: string): string {
  const raw = String(pathOrUrl ?? "");
  const withoutQuery = raw.split("?")[0] ?? raw;
  try {
    // Absolute URL: keep only the pathname.
    return new URL(withoutQuery).pathname;
  } catch {
    return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  }
}

function emptyTally(): Record<OnshapeAuthPath, number> {
  return { session: 0, oauth: 0, "api-key": 0 };
}

export type CallBudgetOptions = {
  /** Keep at most this many entries in memory (oldest dropped). */
  limit?: number;
  now?: () => number;
  /** Called the first time a quota-consuming path serves a call. */
  onQuotaCall?: (entry: CallBudgetEntry) => void;
};

const DEFAULT_ENTRY_LIMIT = 500;

export function createCallBudget(options: CallBudgetOptions = {}): CallBudget {
  const limit = Math.max(1, options.limit ?? DEFAULT_ENTRY_LIMIT);
  const now = options.now ?? Date.now;
  let entries: CallBudgetEntry[] = [];
  let warnedQuota = false;

  function record(input: Omit<CallBudgetEntry, "at" | "countsAgainstAnnualCap"> & { at?: string }): CallBudgetEntry {
    const entry: CallBudgetEntry = {
      at: input.at ?? new Date(now()).toISOString(),
      authPath: input.authPath,
      method: (input.method || "GET").toUpperCase(),
      path: ledgerPath(input.path),
      status: input.status,
      ok: input.ok,
      countsAgainstAnnualCap: countsAgainstAnnualCap(input.authPath, input.status),
      durationMs: Math.max(0, Math.round(input.durationMs)),
    };
    entries = [...entries, entry].slice(-limit);
    if (entry.countsAgainstAnnualCap && !warnedQuota) {
      warnedQuota = true;
      options.onQuotaCall?.(entry);
    }
    return entry;
  }

  return {
    record,
    attribute(http, authPath): AttributedHttp {
      return async (path: string, init?: RequestInit): Promise<Response> => {
        const started = now();
        try {
          const response = await http(path, init);
          record({
            authPath,
            method: String(init?.method ?? "GET"),
            path,
            status: response.status,
            ok: response.ok,
            durationMs: now() - started,
          });
          return response;
        } catch (error) {
          // A transport failure never reaches Onshape, so it cannot be charged:
          // status 0 scores as uncounted under the 2xx/3xx rule. Wrappers that turn a
          // real HTTP status into a typed error (session expiry) carry `httpStatus`
          // so the ledger records what Onshape actually answered.
          const carried = Number((error as { httpStatus?: unknown } | null)?.httpStatus);
          record({
            authPath,
            method: String(init?.method ?? "GET"),
            path,
            status: Number.isFinite(carried) ? carried : 0,
            ok: false,
            durationMs: now() - started,
          });
          throw error;
        }
      };
    },
    summary() {
      const byAuthPath = emptyTally();
      let annualCapCalls = 0;
      for (const entry of entries) {
        byAuthPath[entry.authPath] += 1;
        if (entry.countsAgainstAnnualCap) annualCapCalls += 1;
      }
      const warnings: string[] = [];
      if (byAuthPath["api-key"] > 0) {
        warnings.push(
          `${byAuthPath["api-key"]} call${byAuthPath["api-key"] === 1 ? "" : "s"} used the Onshape API-key path, which is deducted from your annual allowance. Run \`vantage-cad login\` to sign in with a browser session instead.`,
        );
      }
      if (byAuthPath.oauth > 0) {
        warnings.push(
          `${byAuthPath.oauth} call${byAuthPath.oauth === 1 ? "" : "s"} used OAuth. Onshape counts OAuth calls from non-App-Store applications against the same annual allowance.`,
        );
      }
      return {
        total: entries.length,
        byAuthPath,
        annualCapCalls,
        headline: callBudgetHeadline(byAuthPath, annualCapCalls),
        warnings,
        entries: [...entries],
      };
    },
    reset() {
      entries = [];
      warnedQuota = false;
    },
  };
}

export function callBudgetHeadline(byAuthPath: Record<OnshapeAuthPath, number>, annualCapCalls: number): string {
  const parts = [
    `${byAuthPath.session} session call${byAuthPath.session === 1 ? "" : "s"}`,
    `${byAuthPath["api-key"]} API-key call${byAuthPath["api-key"] === 1 ? "" : "s"}`,
  ];
  if (byAuthPath.oauth > 0) parts.splice(1, 0, `${byAuthPath.oauth} OAuth call${byAuthPath.oauth === 1 ? "" : "s"}`);
  return `${parts.join(", ")} — ${annualCapCalls} charged to the Onshape annual cap`;
}

export function formatCallBudget(summary: CallBudgetSummary): string[] {
  const lines = [summary.headline];
  for (const warning of summary.warnings) lines.push(`  warning: ${warning}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Lifetime tally (persisted alongside the CAD session so the annual cap is visible
// across process restarts, not just within one run)
// ---------------------------------------------------------------------------

export type PersistedCallTally = {
  session: number;
  oauth: number;
  apiKey: number;
  /** Running total of calls Onshape will have charged to the annual allowance. */
  annualCapCalls: number;
  since: string;
  updatedAt: string;
};

export function emptyCallTally(at = new Date().toISOString()): PersistedCallTally {
  return { session: 0, oauth: 0, apiKey: 0, annualCapCalls: 0, since: at, updatedAt: at };
}

export function mergeCallTally(
  previous: PersistedCallTally | undefined,
  summary: CallBudgetSummary,
  at = new Date().toISOString(),
): PersistedCallTally {
  const base = previous ?? emptyCallTally(at);
  return {
    session: base.session + summary.byAuthPath.session,
    oauth: base.oauth + summary.byAuthPath.oauth,
    apiKey: base.apiKey + summary.byAuthPath["api-key"],
    annualCapCalls: base.annualCapCalls + summary.annualCapCalls,
    since: base.since,
    updatedAt: at,
  };
}

/**
 * Honest framing for a status surface: Vantage only knows the calls IT made from
 * this machine. Onshape pools the real allowance across the whole company, so the
 * authoritative number lives in Onshape's own usage page, never here.
 */
export function describeCallTally(tally: PersistedCallTally | undefined): string {
  if (!tally || tally.session + tally.oauth + tally.apiKey === 0) {
    return "No Onshape calls recorded from this machine yet.";
  }
  return [
    `Since ${tally.since.slice(0, 10)}: ${tally.session} session, ${tally.oauth} OAuth, ${tally.apiKey} API-key calls`,
    `${tally.annualCapCalls} charged to the Onshape annual cap by this machine (Onshape pools the real allowance company-wide — check Onshape's own usage page for the authoritative number).`,
  ].join(" · ");
}
