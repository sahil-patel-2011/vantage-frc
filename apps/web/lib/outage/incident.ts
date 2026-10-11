import { randomBytes } from "node:crypto";
import { classifyDatabaseFailure, type OutageClassification, type OutageCode } from "./classify";
import { NOTICE_KEY } from "./notice";
import { readJson, writeJson, type OutageStore } from "./status-store";

/**
 * One open database incident at a time, and the owner's email about it.
 *
 * reportDatabaseFailure / reportDatabaseHealthy are called from /api/health (what an uptime
 * monitor hits) and from /api/me's database-failure path. They never throw and are meant to
 * run after the response (`deferOutageWork`), so a request is never held up by email.
 *
 * Who is told what, and when:
 * - The first failure of an incident sends ONE email to PLATFORM_OWNER_EMAIL — nobody else.
 * - Then only if the cause changes (each cause once, at least 10 minutes after the last email)
 *   or as a reminder every 6 hours while it stays open.
 * - When the database answers again, the incident closes and the owner gets one "back" email.
 * - A failure within 15 minutes of a recovery reopens the same incident instead of starting a
 *   new one; if the owner was already told it was back, they are told it is down again — at
 *   most once per 30 minutes, so a flapping connection cannot flood their inbox.
 * Concurrent requests agree through set-if-absent locks in the outage store.
 */

export const INCIDENT_KEY = "incident";
const INCIDENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REMINDER_MS = 6 * 60 * 60 * 1000;
export const CAUSE_CHANGE_MIN_MS = 10 * 60 * 1000;
export const REALERT_AFTER_RECOVERY_MS = 30 * 60 * 1000;
const RETRY_FAILED_SEND_MS = 5 * 60 * 1000;
export const REOPEN_WINDOW_MS = 15 * 60 * 1000;
/** Per server instance: fold repeat failures into one store write this often. */
const WRITE_EVERY_MS = 15_000;
const HEALTHY_RECHECK_MS = 30_000;
/** Per server instance, whatever the store says: a backstop against a bug or a flapping link. */
const MAX_OWNER_EMAILS_PER_HOUR = 6;

export type OutageIncident = {
  v: 1;
  id: string;
  firstSeen: string;
  lastSeen: string;
  closedAt: string | null;
  failures: number;
  sources: string[];
  classification: OutageClassification;
  causes: OutageCode[];
  alerts: {
    /** Alert emails claimed so far (the lock sequence). */
    sent: number;
    lastAt: string | null;
    emailedCodes: OutageCode[];
    /** True once an alert went out and no "back" email has followed it. */
    ownerKnowsDown: boolean;
    lastError: string | null;
    /** Alerts the provider accepted. Until one is, a retry is still the "first" email. */
    delivered?: number;
  };
  /** Times this incident closed (the "back" lock sequence). */
  recoveries: number;
};

export type AlertReason = "first" | "again" | "cause" | "reminder";
export type OwnerMail = { to: string; subject: string; text: string };

export type ReporterDeps = {
  store: OutageStore;
  sendOwnerEmail: (mail: OwnerMail) => Promise<void>;
  /** PLATFORM_OWNER_EMAIL, or null when unset. */
  ownerEmail: () => string | null;
  /** Signed outage-console link for this incident, or null when it can't be signed. */
  consoleUrl: (incidentId: string) => string | null;
  now?: () => number;
  newId?: () => string;
  log?: { warn: (message: string) => void; error: (message: string) => void };
  /** IANA zone for times in emails; UTC by default. */
  timeZone?: string;
};

export type OutageReporter = {
  reportFailure(error: unknown, source: string): Promise<void>;
  reportHealthy(source: string): Promise<void>;
};

const iso = (ms: number) => new Date(ms).toISOString();

export async function readIncident(store: OutageStore): Promise<OutageIncident | null> {
  const incident = await readJson<OutageIncident>(store, INCIDENT_KEY);
  if (!incident || incident.v !== 1 || typeof incident.id !== "string") return null;
  // Alert bookkeeping lives in its own record (see writeAlerts), so a concurrent writer of the
  // incident can't wind it back; the incident's copy is only a fallback for older records.
  const alerts = await readJson<OutageIncident["alerts"]>(store, alertsKey(incident.id));
  return alerts ? { ...incident, alerts } : incident;
}

const alertsKey = (incidentId: string) => `alerts:${incidentId}`;

/**
 * Only the holder of an alert or close lock writes this, so two requests that both saw the
 * first failure can't leave it saying "nobody was emailed" after one of them emailed.
 */
async function writeAlerts(store: OutageStore, incidentId: string, alerts: OutageIncident["alerts"]) {
  await writeJson(store, alertsKey(incidentId), alerts, { ttlSeconds: INCIDENT_TTL_SECONDS });
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function formatWhen(value: string, timeZone = "UTC"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // dateStyle can't be combined with timeZoneName, so the parts are spelled out.
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** Whether this failure should email the owner, and why. Pure. */
export function alertReason(incident: OutageIncident, now: number): AlertReason | null {
  const alerts = incident.alerts;
  const since = alerts.lastAt ? now - Date.parse(alerts.lastAt) : Number.POSITIVE_INFINITY;
  if (!alerts.ownerKnowsDown) {
    if (alerts.sent === 0) return "first";
    if (since < (alerts.lastError ? RETRY_FAILED_SEND_MS : REALERT_AFTER_RECOVERY_MS)) return null;
    // The owner never received one (the first send failed): this is still the first they hear.
    return (alerts.delivered ?? 0) === 0 ? "first" : "again";
  }
  const code = incident.classification.code;
  if (!alerts.emailedCodes.includes(code) && since >= CAUSE_CHANGE_MIN_MS) return "cause";
  if (since >= REMINDER_MS) return "reminder";
  return null;
}

const STILL_WORKS = [
  "What still works:",
  "- Scouting keeps saving on phones and tablets, and syncs on its own once the database is back.",
  "- Each team's spreadsheet copy (Google Sheets or Excel) is still readable.",
  "- Pages show a \"try again in a moment\" screen instead of hanging. Nobody can sign in until it's back.",
];

export function alertEmail(
  incident: OutageIncident,
  reason: AlertReason,
  consoleUrl: string | null,
  now: number,
  timeZone?: string,
): Omit<OwnerMail, "to"> {
  const c = incident.classification;
  const downFor = formatDuration(now - Date.parse(incident.firstSeen));
  const subject =
    reason === "cause"
      ? `Vantage: the NAS database is still down — now: ${c.title}`
      : reason === "reminder"
        ? `Vantage: the NAS database is still unreachable (${downFor}) — ${c.title}`
        : reason === "again"
          ? `Vantage: the NAS database is unreachable again — ${c.title}`
          : `Vantage: the NAS database is unreachable — ${c.title}`;
  const failed = [c.errorCode, c.host ? `host ${c.host}` : null].filter(Boolean).join(", ");
  const lines = [
    reason === "cause"
      ? "Vantage still can't use its database, and the reason has changed."
      : reason === "reminder"
        ? `Vantage still can't use its database. It has been down for ${downFor}.`
        : "Vantage can't use its database on the NAS.",
    "",
    `What failed: ${c.title}${failed ? ` (${failed})` : ""}`,
    `Why: ${c.why}`,
    `What to try: ${c.fix}`,
    ...(c.detail ? [`Error: ${c.detail}`] : []),
    "",
    `First seen: ${formatWhen(incident.firstSeen, timeZone)}`,
    `Failed checks so far: ${incident.failures} (from ${incident.sources.join(", ") || "the app"})`,
    "",
    ...STILL_WORKS,
    "",
    consoleUrl
      ? `Outage console — no sign-in needed, the link works for 24 hours:\n${consoleUrl}\nFrom there you can email everyone that Vantage is limited and turn on a banner in the app.`
      : "The outage console link could not be made (BETTER_AUTH_SECRET is missing).",
    "",
    "This email went only to you (PLATFORM_OWNER_EMAIL). Nobody else has been told.",
    "You'll get one more email when the database answers again.",
  ];
  return { subject, text: lines.join("\n") };
}

export function recoveryEmail(
  incident: OutageIncident,
  closedAt: number,
  bannerOn: boolean,
  consoleUrl: string | null,
  timeZone?: string,
): Omit<OwnerMail, "to"> {
  const duration = formatDuration(closedAt - Date.parse(incident.firstSeen));
  const lines = [
    "The NAS database is answering again.",
    "",
    `Down for: ${duration} (first seen ${formatWhen(incident.firstSeen, timeZone)}, back ${formatWhen(iso(closedAt), timeZone)})`,
    `Last cause: ${incident.classification.title}`,
    `Failed checks while down: ${incident.failures}`,
    "",
    "Phones that saved scouting while it was down sync on their own the next time the app is open.",
    "",
    bannerOn
      ? 'The "Vantage is limited" banner is still showing for everyone. Turn it off, or email everyone that Vantage is back, from the outage console:'
      : "If you'd like to tell everyone it's fixed, the outage console can email them:",
    consoleUrl ?? "(The console link could not be made: BETTER_AUTH_SECRET is missing.)",
  ];
  return { subject: `Vantage is back — the database answered again after ${duration}`, text: lines.join("\n") };
}

function safeMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").slice(0, 160);
}

export function createOutageReporter(deps: ReporterDeps): OutageReporter {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => randomBytes(9).toString("base64url"));
  const log = deps.log ?? { warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) };
  const store = deps.store;
  // Per instance: what this instance last wrote, so a burst of failures is one write.
  let memo: { openId: string | null; code: OutageCode | null; writtenAt: number; pending: number; sources: Set<string> } = {
    openId: null,
    code: null,
    writtenAt: 0,
    pending: 0,
    sources: new Set(),
  };
  let healthyCheckedAt = 0;
  const sentAt: number[] = [];
  const ownerWarned = new Set<string>();

  function underHourlyCap(at: number) {
    while (sentAt.length && at - sentAt[0]! > 60 * 60 * 1000) sentAt.shift();
    return sentAt.length < MAX_OWNER_EMAILS_PER_HOUR;
  }

  async function mailOwner(incidentId: string, mail: Omit<OwnerMail, "to">, at: number): Promise<"sent" | "no_owner" | "capped" | "failed"> {
    const to = deps.ownerEmail();
    if (!to) {
      if (!ownerWarned.has(incidentId)) {
        ownerWarned.add(incidentId);
        log.warn("[outage] PLATFORM_OWNER_EMAIL is not set, so nobody was emailed about the database outage.");
      }
      return "no_owner";
    }
    if (!underHourlyCap(at)) {
      log.warn("[outage] Owner email skipped: this server already sent the hourly maximum.");
      return "capped";
    }
    sentAt.push(at);
    try {
      await deps.sendOwnerEmail({ to, ...mail });
      return "sent";
    } catch (error) {
      log.error(`[outage] Could not email the owner: ${safeMessage(error)}`);
      return "failed";
    }
  }

  async function openIncident(previous: OutageIncident | null, at: number, classification: OutageClassification) {
    if (previous?.closedAt && at - Date.parse(previous.closedAt) < REOPEN_WINDOW_MS) {
      return { ...previous, closedAt: null };
    }
    // Concurrent first failures agree on one id: the first to claim the slot names it.
    const lockKey = `lock:open:${previous?.id ?? "none"}`;
    const candidate = newId();
    const claimed = await store.set(lockKey, candidate, { onlyIfAbsent: true, ttlSeconds: 24 * 60 * 60 });
    const id = claimed ? candidate : ((await store.get(lockKey)) ?? candidate);
    const incident: OutageIncident = {
      v: 1,
      id,
      firstSeen: iso(at),
      lastSeen: iso(at),
      closedAt: null,
      failures: 0,
      sources: [],
      classification,
      causes: [],
      alerts: { sent: 0, lastAt: null, emailedCodes: [], ownerKnowsDown: false, lastError: null },
      recoveries: 0,
    };
    return incident;
  }

  async function reportFailure(error: unknown, source: string) {
    try {
      const at = now();
      const classification = classifyDatabaseFailure(error);
      if (memo.openId && memo.code === classification.code && at - memo.writtenAt < WRITE_EVERY_MS) {
        memo.pending += 1;
        memo.sources.add(source);
        return;
      }
      healthyCheckedAt = 0;
      const stored = await readIncident(store);
      const incident = !stored || stored.closedAt ? await openIncident(stored, at, classification) : stored;
      const pending = memo.openId === incident.id ? memo.pending : 0;
      const sources = new Set([...incident.sources, ...(memo.openId === incident.id ? memo.sources : []), source]);
      incident.failures += 1 + pending;
      incident.lastSeen = iso(at);
      incident.sources = [...sources].slice(0, 8);
      incident.classification = classification;
      if (!incident.causes.includes(classification.code)) incident.causes = [...incident.causes, classification.code].slice(0, 12);

      const reason = alertReason(incident, at);
      const owner = deps.ownerEmail();
      let claimed = false;
      if (reason && owner && underHourlyCap(at)) {
        claimed = await store.set(`lock:alert:${incident.id}:${incident.alerts.sent}`, iso(at), {
          onlyIfAbsent: true,
          ttlSeconds: LOCK_TTL_SECONDS,
        });
      } else if (reason && !owner && !ownerWarned.has(incident.id)) {
        ownerWarned.add(incident.id);
        log.warn("[outage] PLATFORM_OWNER_EMAIL is not set, so nobody was emailed about the database outage.");
      }
      if (claimed) {
        incident.alerts = {
          ...incident.alerts,
          sent: incident.alerts.sent + 1,
          lastAt: iso(at),
          emailedCodes: [...new Set([...incident.alerts.emailedCodes, classification.code])],
          ownerKnowsDown: true,
          lastError: null,
        };
        await writeAlerts(store, incident.id, incident.alerts);
      }
      await writeJson(store, INCIDENT_KEY, incident, { ttlSeconds: INCIDENT_TTL_SECONDS });
      memo = { openId: incident.id, code: classification.code, writtenAt: at, pending: 0, sources: new Set() };

      if (claimed && reason) {
        const mail = alertEmail(incident, reason, deps.consoleUrl(incident.id), at, deps.timeZone);
        const outcome = await mailOwner(incident.id, mail, at);
        // Not delivered: let the next failure try again (after a short wait) instead of
        // believing the owner knows. Delivered: count it, so a later alert says "again".
        incident.alerts =
          outcome === "sent"
            ? { ...incident.alerts, delivered: (incident.alerts.delivered ?? 0) + 1 }
            : { ...incident.alerts, ownerKnowsDown: false, lastError: outcome };
        await writeAlerts(store, incident.id, incident.alerts);
      }
    } catch (failure) {
      log.error(`[outage] Could not record the database failure: ${safeMessage(failure)}`);
    }
  }

  async function reportHealthy(_source: string) {
    try {
      const at = now();
      if (!memo.openId && healthyCheckedAt && at - healthyCheckedAt < HEALTHY_RECHECK_MS) return;
      healthyCheckedAt = at;
      const incident = await readIncident(store);
      memo = { openId: null, code: null, writtenAt: 0, pending: 0, sources: new Set() };
      if (!incident || incident.closedAt) return;
      // Everyone who sees the recovery closes the incident; only the lock holder emails.
      const won = await store.set(`lock:close:${incident.id}:${incident.recoveries}`, iso(at), {
        onlyIfAbsent: true,
        ttlSeconds: LOCK_TTL_SECONDS,
      });
      const notify = won && incident.alerts.ownerKnowsDown;
      const closed: OutageIncident = {
        ...incident,
        closedAt: iso(at),
        recoveries: incident.recoveries + 1,
        alerts: { ...incident.alerts, ownerKnowsDown: false },
      };
      await writeJson(store, INCIDENT_KEY, closed, { ttlSeconds: INCIDENT_TTL_SECONDS });
      if (won) await writeAlerts(store, incident.id, closed.alerts);
      if (!notify) return;
      const bannerOn = Boolean(await store.get(NOTICE_KEY).catch(() => null));
      const mail = recoveryEmail(incident, at, bannerOn, deps.consoleUrl(incident.id), deps.timeZone);
      await mailOwner(incident.id, mail, at);
    } catch (failure) {
      log.error(`[outage] Could not record the database recovery: ${safeMessage(failure)}`);
    }
  }

  return { reportFailure, reportHealthy };
}

let defaultReporter: Promise<OutageReporter> | null = null;

function reporter(): Promise<OutageReporter> {
  // Loaded on first use so modules (and tests) that never report don't pull in @vantage/core.
  defaultReporter ??= import("./runtime").then((runtime) => createOutageReporter(runtime.defaultReporterDeps()));
  return defaultReporter;
}

/** Record that the database failed. Never throws; run it after the response. */
export async function reportDatabaseFailure(error: unknown, source: string): Promise<void> {
  try {
    await (await reporter()).reportFailure(error, source);
  } catch {
    // Reporting must never become the second failure.
  }
}

/** Record that the database answered. Closes an open incident. Never throws. */
export async function reportDatabaseHealthy(source: string): Promise<void> {
  try {
    await (await reporter()).reportHealthy(source);
  } catch {
    // As above.
  }
}
