/**
 * Module health for the operator: one list of what Vantage runs on, each Healthy, Degraded,
 * Down or Not set up, and behind each one the problem in plain words, when it started, the
 * recent errors and log lines from the real sources, and how to fix it.
 *
 * Pure: `load-module-health.ts` gathers the signals (the integration-health checks, the outage
 * incident, the job and ingest tables, the AI key pool) and this file decides. Nothing here
 * invents a status: a module with no signal and no configuration is "Not set up", and a module
 * whose configuration is present but cannot be tested without side effects says so
 * (`checked: "settings"`). Every log line passes through `redactSecrets` before it is returned.
 */
import type { IntegrationCheck, IntegrationState } from "./integration-health";

export type ModuleStatus = "healthy" | "degraded" | "down" | "not_set_up";

export type ModuleLogLine = { at: string | null; source: string; message: string };

export type ModuleHealth = {
  id: ModuleId;
  label: string;
  status: ModuleStatus;
  /** One sentence: what is true right now. */
  summary: string;
  /** "live": a real observed signal. "settings": only the configuration was checked. */
  checked: "live" | "settings";
  checkedAt: string;
  /** When the current problem started, when known. */
  since: string | null;
  lastSuccessAt: string | null;
  /** What is wrong, in plain words (null when healthy). */
  problem: string | null;
  /** Steps that fix it, in order. Env var names are fine here: operators only. */
  fix: string[];
  fixLink: { label: string; href: string } | null;
  logs: ModuleLogLine[];
};

export const MODULE_IDS = [
  "database",
  "sign_in",
  "email",
  "tba",
  "statbotics",
  "nas_sync",
  "spreadsheet_mirror",
  "github",
  "onshape",
  "ai_providers",
  "outage_alerts",
  "rate_limiting",
  "jobs",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);
}

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  not_set_up: "Not set up",
};

// ---------------------------------------------------------------------------------------------
// Redaction: log lines come from error columns written by many jobs and providers.
// ---------------------------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Connection strings and any URL carrying credentials.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi, "[connection string removed]"],
  [/\b(postgres|postgresql|redis|rediss|mysql|mongodb(?:\+srv)?):\/\/\S+/gi, "[connection string removed]"],
  // Provider and platform key shapes.
  [/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{8,}/g, "[key removed]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[key removed]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{10,}/g, "[token removed]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[token removed]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[key removed]"],
  [/\bre_[A-Za-z0-9]{16,}/g, "[key removed]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[token removed]"],
  // Headers and key=value pairs.
  [/\b(authorization|x-api-key|api-key)\s*[:=]\s*(?:bearer\s+)?\S+/gi, "$1: [removed]"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [removed]"],
  [/\b(password|passwd|pwd|secret|token|apikey|api_key|access_key|private_key|client_secret)\s*[=:]\s*\S+/gi, "$1=[removed]"],
  // Any other name that ends like a credential: X-TBA-Auth-Key=…, NEXUS_AUTH_KEY: …, refresh_token=….
  [/\b([A-Za-z0-9_-]*(?:key|token|secret|auth|password|credential)s?)\s*[=:]\s*\S+/gi, "$1=[removed]"],
  // Long opaque strings (hex or base64) are almost always secrets or ciphertext.
  [/\b[A-Fa-f0-9]{40,}\b/g, "[hex removed]"],
  [/\b[A-Za-z0-9+/]{48,}={0,2}/g, "[data removed]"],
];

/** Strip anything secret-shaped from a log line, then cap its length. */
export function redactSecrets(text: string | null | undefined, max = 400): string {
  if (!text) return "";
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export type JobHealthRow = {
  source: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  runs24h: number;
  failures24h: number;
  openJobs: number;
  recentErrors: Array<{ at: string | null; message: string | null; scope?: string | null; team?: number | null }>;
};

export type OutageSignal = {
  storeKind: "upstash" | "memory";
  ownerEmailConfigured: boolean;
  incident: {
    firstSeen: string;
    lastSeen: string;
    closedAt: string | null;
    failures: number;
    title: string;
    why: string;
    fix: string;
    causes: string[];
  } | null;
};

export type ReferenceSignal = {
  source: string;
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

export type PoolKeySignal = {
  label: string;
  provider: string;
  enabled: boolean;
  configured: boolean;
  lastUsedAt: string | null;
  degradedAt: string | null;
  degradedReason: string | null;
};

export type ModuleHealthInputs = {
  now: Date;
  checks: IntegrationCheck[];
  /** Whether mail actually leaves this server (a provider is configured), not just "available". */
  emailDelivers?: boolean;
  outage: OutageSignal;
  reference: ReferenceSignal[];
  jobs: JobHealthRow[] | null;
  pool: PoolKeySignal[];
};

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

const RANK: Record<ModuleStatus, number> = { down: 3, degraded: 2, not_set_up: 1, healthy: 0 };

function fromState(state: IntegrationState): ModuleStatus {
  switch (state) {
    case "healthy":
    case "configured":
      return "healthy";
    case "degraded":
      return "degraded";
    case "error":
      return "down";
    default:
      return "not_set_up";
  }
}

function worst(statuses: ModuleStatus[]): ModuleStatus {
  return statuses.reduce<ModuleStatus>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "healthy");
}

function hoursSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? (now.getTime() - parsed) / 3_600_000 : null;
}

function checkLine(check: IntegrationCheck): ModuleLogLine {
  return { at: check.lastSuccessAt, source: check.label, message: redactSecrets(check.reason) };
}

function fromChecks(
  base: Pick<ModuleHealth, "id" | "label"> & { fix: string[]; fixLink?: ModuleHealth["fixLink"] },
  checks: Array<IntegrationCheck | undefined>,
  now: Date,
  options: { summary?: (status: ModuleStatus, present: IntegrationCheck[]) => string } = {},
): ModuleHealth {
  const present = checks.filter((check): check is IntegrationCheck => Boolean(check));
  const status = present.length ? worst(present.map((check) => fromState(check.state))) : "not_set_up";
  const failing = present.filter((check) => fromState(check.state) !== "healthy");
  const live = present.some((check) => check.verification === "live");
  const lastSuccessAt =
    present.map((check) => check.lastSuccessAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null;
  return {
    id: base.id,
    label: base.label,
    status,
    summary: options.summary?.(status, present) ?? (failing[0] ? redactSecrets(failing[0].reason, 200) : present[0] ? redactSecrets(present[0].reason, 200) : "No signal yet."),
    checked: live ? "live" : "settings",
    checkedAt: now.toISOString(),
    since: null,
    lastSuccessAt,
    problem: failing.length ? failing.map((check) => redactSecrets(check.reason, 300)).join(" ") : null,
    fix: status === "healthy" ? [] : base.fix,
    fixLink: status === "healthy" ? null : (base.fixLink ?? null),
    logs: present.map(checkLine),
  };
}

function jobLogs(row: JobHealthRow | undefined, source: string): ModuleLogLine[] {
  return (row?.recentErrors ?? []).slice(0, 10).map((entry) => ({
    at: entry.at,
    source: [source, entry.scope, entry.team != null ? `team ${entry.team}` : null].filter(Boolean).join(" · "),
    message: redactSecrets(entry.message),
  }));
}

/**
 * A job table's state. No rows at all is "Not set up" (the job has never run here); a failure
 * more recent than the last success is "Down"; failures alongside successes in the last day, or
 * no success for `staleHours`, is "Degraded".
 */
export function jobStatus(row: JobHealthRow | undefined, now: Date, staleHours: number): ModuleStatus {
  if (!row || (row.runs24h === 0 && !row.lastSuccessAt && !row.lastFailureAt && row.openJobs === 0)) return "not_set_up";
  const success = row.lastSuccessAt ? Date.parse(row.lastSuccessAt) : 0;
  const failure = row.lastFailureAt ? Date.parse(row.lastFailureAt) : 0;
  if (failure && failure > success) return "down";
  if (row.failures24h > 0) return "degraded";
  const age = hoursSince(row.lastSuccessAt, now);
  if (age === null || age > staleHours) return "degraded";
  return "healthy";
}

export function buildModuleHealth(input: ModuleHealthInputs): ModuleHealth[] {
  const { now } = input;
  const at = now.toISOString();
  const check = (id: string) => input.checks.find((c) => c.id === id);
  const job = (source: string) => input.jobs?.find((row) => row.source === source);
  const modules: ModuleHealth[] = [];

  // ---- Database: the live query plus the outage incident the down alert keeps. ----
  {
    const base = fromChecks(
      {
        id: "database",
        label: "Database",
        fix: ["Check DATABASE_URL / DATABASE_ADMIN_URL in the deployment.", "If the NAS is the host, check it is on and reachable (docs/NAS_DATABASE.md)."],
        fixLink: { label: "Outage contacts and notices", href: "/admin/more" },
      },
      [check("db-request-role"), check("db-worker-role")],
      now,
    );
    const incident = input.outage.incident;
    const logs = [...base.logs];
    let status = base.status;
    let problem = base.problem;
    let since: string | null = null;
    let fix = base.fix;
    if (incident) {
      logs.unshift(
        ...incident.causes.map((cause) => ({ at: incident.lastSeen, source: "Outage incident", message: redactSecrets(cause) })),
        {
          at: incident.firstSeen,
          source: "Outage incident",
          message: redactSecrets(`${incident.title}. ${incident.failures} failed checks since it started.`),
        },
      );
      if (!incident.closedAt) {
        // The page loaded, so the database answers now; an incident still open means it was
        // failing moments ago or is flapping.
        status = worst([status, "degraded"]);
        since = incident.firstSeen;
        problem = redactSecrets(`${incident.title}. ${incident.why}`, 400);
        fix = [incident.fix, ...base.fix];
      }
    }
    modules.push({
      ...base,
      status,
      since,
      problem,
      fix: status === "healthy" ? [] : fix,
      summary: incident && !incident.closedAt ? `Answering now, but an outage is still open: ${incident.title}.` : base.status === "healthy" ? "Connected through the request role." : base.summary,
      logs,
    });
  }

  // ---- Sign-in ----
  {
    const auth = check("better-auth");
    const google = check("google-oauth");
    const status: ModuleStatus = !auth ? "not_set_up" : auth.state === "setup_required" ? "down" : "healthy";
    modules.push({
      id: "sign_in",
      label: "Sign-in",
      status,
      summary:
        status === "down"
          ? "Sessions can't be signed: BETTER_AUTH_SECRET or BETTER_AUTH_URL is missing."
          : google?.state === "setup_required"
            ? "Email codes work. Google sign-in is off."
            : "Email codes and Google sign-in are set up.",
      checked: "settings",
      checkedAt: at,
      since: null,
      lastSuccessAt: null,
      problem: status === "down" ? redactSecrets(auth?.reason) : null,
      fix: status === "down" ? ["Set BETTER_AUTH_SECRET and BETTER_AUTH_URL in the deployment, then redeploy."] : [],
      fixLink: null,
      logs: [auth, google].filter((c): c is IntegrationCheck => Boolean(c)).map(checkLine),
    });
  }

  // ---- Email ----
  {
    const base = fromChecks(
      { id: "email", label: "Email", fix: ["Set RESEND_API_KEY and AUTH_EMAIL_FROM (or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD)."] },
      [check("resend-email")],
      now,
    );
    // A development server reports mail as "available" while writing it to a local mailbox:
    // nothing reaches a person, so that is Not set up here.
    if (input.emailDelivers === false && base.status === "healthy") {
      modules.push({
        ...base,
        status: "not_set_up",
        summary: "No mail provider is set, so sign-in codes, invites and alerts aren't delivered to anyone.",
        problem: "No mail provider is configured on this server.",
        fix: ["Set RESEND_API_KEY and AUTH_EMAIL_FROM (or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD)."],
      });
    } else {
      modules.push(base);
    }
  }

  // ---- TBA and Statbotics: the ingest health rows carry the real errors. ----
  for (const [id, label, checkId, source] of [
    ["tba", "The Blue Alliance", "reference-tba", "tba"],
    ["statbotics", "Statbotics", "reference-statbotics", "statbotics"],
  ] as const) {
    const base = fromChecks(
      {
        id,
        label,
        fix:
          id === "tba"
            ? ["Check the TBA read key under Data connectors.", "Look at the ingest errors below; a 401 means the key was revoked, a 429 that TBA is rate-limiting."]
            : ["Statbotics needs no key. If errors persist, check statbotics.io is up, then run the ingest again."],
        fixLink: { label: "Data connectors", href: "/admin/connectors" },
      },
      [check(checkId)],
      now,
    );
    const ref = input.reference.find((row) => row.source === source);
    const logs = [...base.logs];
    if (ref?.lastError) logs.unshift({ at: ref.lastFailureAt, source: `${label} ingest`, message: redactSecrets(ref.lastError) });
    // Configured but never synced is no signal at all: Not set up, not Healthy.
    const neverRan = base.status === "healthy" && !ref?.lastSuccessAt && !ref?.lastFailureAt && !base.lastSuccessAt;
    modules.push({
      ...base,
      ...(neverRan
        ? {
            status: "not_set_up" as const,
            summary: `No ${label} sync has run on this server yet.`,
            problem: `The ingest has never recorded a ${label} sync here.`,
            fix: ["Set CRON_SECRET so the scheduled ingest runs, or run it from Data connectors."],
            fixLink: { label: "Data connectors", href: "/admin/connectors" },
          }
        : {}),
      since: base.status !== "healthy" && base.status !== "not_set_up" ? (ref?.lastFailureAt ?? null) : null,
      lastSuccessAt: ref?.lastSuccessAt ?? base.lastSuccessAt,
      logs,
    });
  }

  // ---- NAS sync: the encrypted recovery snapshot of the NAS database. ----
  {
    const row = job("recovery_checkpoint");
    const status = input.jobs ? jobStatus(row, now, 48) : "not_set_up";
    modules.push({
      id: "nas_sync",
      label: "NAS backup sync",
      status,
      summary:
        status === "not_set_up"
          ? "No backup snapshot has been recorded on this database yet."
          : status === "healthy"
            ? "The latest snapshot was written and verified."
            : status === "down"
              ? "The latest snapshot failed."
              : "No verified snapshot in the last two days, or some failed.",
      checked: "live",
      checkedAt: at,
      since: status === "down" ? (row?.lastFailureAt ?? null) : null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      problem: status === "down" || status === "degraded" ? redactSecrets(row?.recentErrors[0]?.message ?? "Snapshots are missing or failing.") : null,
      fix:
        status === "healthy"
          ? []
          : ["Run scripts/recovery-checkpoint.mjs on the NAS (docs/NAS_DATABASE.md → Backups).", "Check the Google checkpoint credentials if uploads fail."],
      fixLink: null,
      logs: jobLogs(row, "Recovery checkpoint"),
    });
  }

  // ---- Spreadsheet mirror: Excel and Google copies, plus readable sync jobs. ----
  {
    const mirror = job("spreadsheet_mirror");
    const readable = job("readable_sync");
    const statuses = [jobStatus(mirror, now, 36), jobStatus(readable, now, 36)].filter((s) => s !== "not_set_up");
    const status: ModuleStatus = !input.jobs ? "not_set_up" : statuses.length ? worst(statuses) : "not_set_up";
    modules.push({
      id: "spreadsheet_mirror",
      label: "Spreadsheet copies",
      status,
      summary:
        status === "not_set_up"
          ? "No team has synced a spreadsheet copy yet."
          : status === "healthy"
            ? "Teams' Excel and Google copies are syncing."
            : `${(mirror?.failures24h ?? 0) + (readable?.failures24h ?? 0)} sync failures in the last day.`,
      checked: "live",
      checkedAt: at,
      since: status === "down" ? (mirror?.lastFailureAt ?? readable?.lastFailureAt ?? null) : null,
      lastSuccessAt: [mirror?.lastSuccessAt, readable?.lastSuccessAt].filter((v): v is string => Boolean(v)).sort().pop() ?? null,
      problem:
        status === "down" || status === "degraded"
          ? redactSecrets(mirror?.recentErrors[0]?.message ?? readable?.recentErrors[0]?.message ?? "Recent syncs failed.")
          : null,
      fix: status === "healthy" || status === "not_set_up" ? [] : ["Open the team's Connectors → Spreadsheet copies and run Sync both copies.", "A Google 429 rests that copy for up to an hour; the other copy keeps working."],
      fixLink: status === "healthy" || status === "not_set_up" ? null : { label: "Sheets hub", href: "/admin/integrations" },
      logs: [...jobLogs(mirror, "Workbook sync"), ...jobLogs(readable, "Readable sync")],
    });
  }

  // ---- GitHub and Onshape (settings only: testing them needs a team's account). ----
  modules.push(
    fromChecks({ id: "github", label: "GitHub app", fix: ["Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (docs/GITHUB_CONNECTION.md)."] }, [check("github-oauth")], now),
  );
  modules.push(
    fromChecks({ id: "onshape", label: "Onshape", fix: ["Set the Onshape OAuth client (docs/CLAUDE_CODE_CAD.md)."], fixLink: { label: "CAD setup", href: "/cad/setup" } }, [check("onshape-oauth")], now),
  );

  // ---- AI providers: the platform keys and the operator's pool that pays for AI credit. ----
  {
    const aiChecks = input.checks.filter((c) => c.category === "AI");
    const pool = input.pool.filter((key) => key.enabled);
    const degradedKeys = pool.filter((key) => key.degradedAt);
    const unusable = pool.filter((key) => !key.configured);
    const anyPath = aiChecks.some((c) => c.state !== "setup_required") || pool.some((key) => key.configured);
    let status: ModuleStatus = anyPath ? "healthy" : "not_set_up";
    if (degradedKeys.length || unusable.length) status = degradedKeys.length && degradedKeys.length >= pool.length ? "down" : "degraded";
    const sinceKey = degradedKeys.map((key) => key.degradedAt!).sort()[0] ?? null;
    modules.push({
      id: "ai_providers",
      label: "AI providers",
      status,
      summary:
        status === "not_set_up"
          ? "No platform AI key is set. Teams use their own keys."
          : degradedKeys.length
            ? `${degradedKeys.length} of ${pool.length} pool keys failing: ${degradedKeys.map((key) => key.label).join(", ")}.`
            : unusable.length
              ? `${unusable.length} pool key${unusable.length === 1 ? " names an env var that is" : "s name env vars that are"} not set here.`
              : pool.length
                ? `${pool.length} pool key${pool.length === 1 ? "" : "s"} answering.`
                : "Platform keys are set.",
      checked: degradedKeys.length || pool.some((key) => key.lastUsedAt) ? "live" : "settings",
      checkedAt: at,
      since: sinceKey,
      lastSuccessAt: pool.map((key) => key.lastUsedAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null,
      problem:
        degradedKeys.length || unusable.length
          ? [
              ...degradedKeys.map((key) => `${key.label} (${key.provider}): ${redactSecrets(key.degradedReason ?? "failed", 200)}.`),
              ...unusable.map((key) => `${key.label} (${key.provider}) has no value on this deployment.`),
            ].join(" ")
          : null,
      fix:
        status === "healthy"
          ? []
          : [
              "A 429 or 402 is the provider's limit or balance: top up or raise the limit, or add another key below it.",
              "A rejected key (401/403) was revoked or mistyped: replace it.",
              "Keys are tried in order, so a working key answers while one is failing.",
            ],
      fixLink: { label: "AI credit keys", href: "/admin/ai-credits" },
      logs: [
        ...degradedKeys.map((key) => ({ at: key.degradedAt, source: `Pool key ${key.label}`, message: redactSecrets(key.degradedReason ?? "failed") })),
        ...aiChecks.map(checkLine),
      ],
    });
  }

  // ---- Outage alerts: where the down alert keeps its state and who it emails. ----
  {
    const shared = input.outage.storeKind === "upstash";
    const status: ModuleStatus = !input.outage.ownerEmailConfigured ? "not_set_up" : shared ? "healthy" : "degraded";
    modules.push({
      id: "outage_alerts",
      label: "Outage alerts",
      status,
      summary: !input.outage.ownerEmailConfigured
        ? "PLATFORM_OWNER_EMAIL is not set, so nobody is emailed when the database goes down."
        : shared
          ? "Alerts are stored outside the database and go to the owner."
          : "Alerts work, but each server keeps its own copy, so the owner can get one alert per server.",
      checked: "settings",
      checkedAt: at,
      since: null,
      lastSuccessAt: null,
      problem: status === "healthy" ? null : !input.outage.ownerEmailConfigured ? "No owner email for down alerts." : "No shared store for outage state.",
      fix: !input.outage.ownerEmailConfigured
        ? ["Set PLATFORM_OWNER_EMAIL to the address that should hear when Vantage is down."]
        : shared
          ? []
          : ["Set OUTAGE_REDIS_URL and OUTAGE_REDIS_TOKEN (or the rate limiter's RATE_LIMIT_REDIS_*)."],
      fixLink: null,
      logs: input.outage.incident
        ? [{ at: input.outage.incident.firstSeen, source: "Outage incident", message: redactSecrets(input.outage.incident.title) }]
        : [],
    });
  }

  // ---- Rate limiting ----
  modules.push(
    fromChecks(
      { id: "rate_limiting", label: "Rate limiting and KV", fix: ["Set RATE_LIMIT_REDIS_URL and RATE_LIMIT_REDIS_TOKEN (Upstash-compatible)."] },
      [check("redis-rate-limit")],
      now,
      {
        summary: (status) =>
          status === "healthy" ? "Limits are shared across servers." : "Limits fall back to each server's memory, so a busy event can get uneven limits.",
      },
    ),
  );

  // ---- Scheduled jobs and workers ----
  {
    const cron = fromChecks(
      { id: "jobs", label: "Scheduled jobs and workers", fix: ["Set CRON_SECRET so /api/cron/* runs.", "Look at the job errors below for the one that failed."] },
      [check("cron-secret"), check("cron-reference-ingest")],
      now,
    );
    const provisioning = job("team_provisioning");
    const exports = job("export_jobs");
    const jobStatuses = [jobStatus(provisioning, now, 24 * 30), jobStatus(exports, now, 24 * 30)].filter(
      (s) => s === "down" || s === "degraded",
    );
    const status = worst([cron.status, ...jobStatuses]);
    const provisioningDown = provisioning ? jobStatus(provisioning, now, 24 * 30) === "down" : false;
    const exportsDown = exports ? jobStatus(exports, now, 24 * 30) === "down" : false;
    modules.push({
      ...cron,
      status,
      summary:
        provisioningDown || exportsDown
          ? [provisioningDown ? "The last team setup job failed." : null, exportsDown ? "The last data export failed." : null, cron.status === "not_set_up" ? "CRON_SECRET is not set." : null]
              .filter(Boolean)
              .join(" ")
          : cron.summary,
      since: provisioningDown ? (provisioning?.lastFailureAt ?? null) : exportsDown ? (exports?.lastFailureAt ?? null) : null,
      problem:
        status === "healthy"
          ? null
          : [cron.problem, provisioning && jobStatus(provisioning, now, 24 * 30) === "down" ? "Team setup jobs are failing." : null, exports && jobStatus(exports, now, 24 * 30) === "down" ? "Data exports are failing." : null]
              .filter(Boolean)
              .join(" ") || cron.problem,
      fix: status === "healthy" ? [] : cron.fix.length ? cron.fix : ["Look at the job errors below for the one that failed."],
      logs: [...cron.logs, ...jobLogs(provisioning, "Team setup"), ...jobLogs(exports, "Export")],
    });
  }

  return modules;
}

export function summarizeModules(modules: ModuleHealth[]): Record<ModuleStatus, number> {
  const counts: Record<ModuleStatus, number> = { healthy: 0, degraded: 0, down: 0, not_set_up: 0 };
  for (const module of modules) counts[module.status] += 1;
  return counts;
}

/** The list view: everything but the logs and fix steps, which load with the detail. */
export function moduleListItem(module: ModuleHealth) {
  return {
    id: module.id,
    label: module.label,
    status: module.status,
    summary: module.summary,
    checked: module.checked,
    checkedAt: module.checkedAt,
    since: module.since,
  };
}
