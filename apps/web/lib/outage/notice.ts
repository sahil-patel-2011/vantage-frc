import { readJson, writeJson, type OutageStore } from "./status-store";

/**
 * The public "Vantage is limited right now" flag behind GET /api/status and the banner in the
 * app. Turned on from the outage console (with the owner's message), off from the same place.
 * It expires on its own after three days so a forgotten banner doesn't stay up for good.
 */

export const NOTICE_KEY = "notice";
export const NOTICE_TTL_SECONDS = 3 * 24 * 60 * 60;
export const NOTICE_MESSAGE_MAX = 280;

export type ServiceNotice = {
  limited: true;
  message: string;
  since: string;
  incidentId: string | null;
};

export type PublicStatus = { limited: boolean; message?: string; since?: string };

/** Short enough for one banner line or two; cut at a word, never mid-word. */
export function bannerMessage(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= NOTICE_MESSAGE_MAX) return clean;
  const cut = clean.slice(0, NOTICE_MESSAGE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 200 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

export async function readNotice(store: OutageStore): Promise<ServiceNotice | null> {
  const notice = await readJson<ServiceNotice>(store, NOTICE_KEY);
  return notice?.limited === true && typeof notice.message === "string" ? notice : null;
}

export async function turnOnNotice(
  store: OutageStore,
  input: { message: string; incidentId: string | null; now?: number },
): Promise<ServiceNotice> {
  const existing = await readNotice(store);
  const notice: ServiceNotice = {
    limited: true,
    message: bannerMessage(input.message),
    // Keep the original start when the message is only being updated.
    since: existing?.since ?? new Date(input.now ?? Date.now()).toISOString(),
    incidentId: input.incidentId,
  };
  await writeJson(store, NOTICE_KEY, notice, { ttlSeconds: NOTICE_TTL_SECONDS });
  forgetCachedPublicStatus();
  return notice;
}

export async function turnOffNotice(store: OutageStore): Promise<void> {
  await store.delete(NOTICE_KEY);
  forgetCachedPublicStatus();
}

export function publicStatus(notice: ServiceNotice | null): PublicStatus {
  if (!notice) return { limited: false };
  return { limited: true, message: notice.message, since: notice.since };
}

const STATUS_MEMO_MS = 10_000;
let statusMemo: { at: number; status: PublicStatus } | null = null;

/** GET /api/status: the public status, remembered for 10 s per instance. Never throws. */
export async function cachedPublicStatus(store: OutageStore, now = Date.now()): Promise<PublicStatus> {
  if (statusMemo && now - statusMemo.at < STATUS_MEMO_MS) return statusMemo.status;
  let status: PublicStatus;
  try {
    status = publicStatus(await readNotice(store));
  } catch {
    status = { limited: false };
  }
  statusMemo = { at: now, status };
  return status;
}

/** After the console changes the flag, so this instance answers the new value at once. */
export function forgetCachedPublicStatus() {
  statusMemo = null;
}
