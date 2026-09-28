export const INBOX_UPDATED = "vantage:inbox-updated";
export type InboxUpdate = { userId: string; orgId: string | null; unreadCount: number; mutation?: boolean; sourceId?: string };
let sourceId = "";
export function ownInboxUpdate(data: InboxUpdate) { return Boolean(sourceId) && data.sourceId === sourceId; }
export function validInboxUpdate(value: unknown): value is InboxUpdate {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<InboxUpdate>;
  return typeof data.userId === "string" && data.userId.length > 0
    && (data.orgId === null || typeof data.orgId === "string")
    && typeof data.unreadCount === "number" && Number.isSafeInteger(data.unreadCount) && data.unreadCount >= 0
    && (data.mutation === undefined || typeof data.mutation === "boolean")
    && (data.sourceId === undefined || typeof data.sourceId === "string");
}
export function publishInboxUpdate(data: InboxUpdate) {
  if (typeof window === "undefined" || !validInboxUpdate(data)) return;
  if (!sourceId) sourceId = crypto.randomUUID();
  const update = { ...data, sourceId };
  window.dispatchEvent(new CustomEvent(INBOX_UPDATED, { detail: update }));
  try {
    const channel = new BroadcastChannel(INBOX_UPDATED);
    channel.postMessage(update); channel.close();
  } catch { /* Same-tab updates work when cross-tab messaging is unavailable. */ }
}
export function listenInboxUpdates(onUpdate: (data: InboxUpdate) => void) {
  const receive = (data: unknown) => { if (validInboxUpdate(data)) onUpdate(data); };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  window.addEventListener(INBOX_UPDATED, local);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(INBOX_UPDATED);
    channel.onmessage = event => receive(event.data);
  } catch { /* Cross-tab messaging is optional. */ }
  return () => { window.removeEventListener(INBOX_UPDATED, local); channel?.close(); };
}
