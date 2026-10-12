import { readJson, writeJson, type OutageStore } from "./status-store";

/**
 * "Email everyone" from the outage console: one plain email per person (no shared To/BCC
 * list, so nobody sees anyone else's address), a couple at a time with a pause between, so
 * a free Resend or Gmail account isn't rate-limited halfway through. Progress lives in the
 * outage store, so the console can show "Sent 40 of 120" and pick up where a cut-off run
 * stopped.
 */

export type NoticeKind = "limited" | "recovered";
export type BroadcastAudience = "everyone" | "owner";

export type BroadcastJob = {
  v: 1;
  kind: NoticeKind;
  /** 1 for the first send of this kind in an incident, 2 after "send again", … */
  seq: number;
  audience: BroadcastAudience;
  subject: string;
  /** The text the first recipients got; "Continue sending" sends exactly this. */
  message?: string;
  total: number;
  sent: number;
  failed: number;
  nextIndex: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export const BATCH_SIZE = 2;
export const BATCH_PAUSE_MS = 1_100;
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A run that hasn't written progress for this long stopped (the function timed out). */
export const STALLED_AFTER_MS = 90_000;

export const broadcastKey = (incidentId: string, kind: NoticeKind) => `broadcast:${incidentId}:${kind}`;

export const DEFAULT_NOTICE: Record<NoticeKind, { subject: string; message: string }> = {
  limited: {
    subject: "Vantage is running with limited features",
    message:
      "Vantage is running with limited features while we fix a server problem. Scouting you record keeps saving on your phone and will sync when we're back. Your team's spreadsheet copy is still readable. We'll email again when everything works.",
  },
  recovered: {
    subject: "Vantage is working normally again",
    message:
      "Vantage is working normally again. Scouting saved on phones while we were down syncs on its own the next time the app is open. Thanks for your patience.",
  },
};

const FOOTER =
  "\n\n—\nYou're getting this because you have a Vantage account. It's a one-off service notice, not a mailing list.";

export function noticeEmailText(message: string): string {
  return `${message.trim()}${FOOTER}`;
}

export async function readBroadcastJob(store: OutageStore, incidentId: string, kind: NoticeKind) {
  const job = await readJson<BroadcastJob>(store, broadcastKey(incidentId, kind));
  return job?.v === 1 ? job : null;
}

export function jobStalled(job: BroadcastJob, now = Date.now()): boolean {
  return !job.finishedAt && job.nextIndex < job.total && now - Date.parse(job.updatedAt) > STALLED_AFTER_MS;
}

/** Still sending: not finished, recipients left, and progress saved recently. */
export function jobRunning(job: BroadcastJob, now = Date.now()): boolean {
  return !job.finishedAt && job.nextIndex < job.total && !jobStalled(job, now);
}

export type RunBroadcastInput = {
  store: OutageStore;
  incidentId: string;
  job: BroadcastJob;
  recipients: readonly string[];
  message: string;
  send: (to: string, subject: string, text: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  batchSize?: number;
  pauseMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Send from `job.nextIndex` to the end, saving progress after every batch. Never throws. */
export async function runBroadcast(input: RunBroadcastInput): Promise<BroadcastJob> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const batchSize = Math.max(1, input.batchSize ?? BATCH_SIZE);
  const pauseMs = input.pauseMs ?? BATCH_PAUSE_MS;
  const text = noticeEmailText(input.message);
  let job = { ...input.job };
  const save = () =>
    writeJson(input.store, broadcastKey(input.incidentId, job.kind), job, { ttlSeconds: JOB_TTL_SECONDS }).catch(() => false);

  async function deliver(to: string) {
    try {
      await input.send(to, job.subject, text);
      return true;
    } catch {
      // Usually a provider rate limit: one slower retry.
      await sleep(pauseMs * 2);
      try {
        await input.send(to, job.subject, text);
        return true;
      } catch {
        return false;
      }
    }
  }

  while (job.nextIndex < input.recipients.length) {
    const batch = input.recipients.slice(job.nextIndex, job.nextIndex + batchSize);
    const results = await Promise.all(batch.map(deliver));
    const delivered = results.filter(Boolean).length;
    job = {
      ...job,
      sent: job.sent + delivered,
      failed: job.failed + (results.length - delivered),
      nextIndex: job.nextIndex + batch.length,
      updatedAt: new Date(now()).toISOString(),
    };
    await save();
    if (job.nextIndex < input.recipients.length) await sleep(pauseMs);
  }
  job = { ...job, finishedAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
  await save();
  return job;
}
