"use client";

/**
 * Browser half of Web Push. The service worker is already registered globally by
 * `app/pwa-register.tsx`; this module only handles permission + subscription and
 * the two `/api/push` calls.
 *
 * Support reality (do not paper over it in the UI):
 *  - Chrome / Edge / Firefox / Opera on desktop and Android: works.
 *  - iOS and iPadOS: Safari 16.4+ ONLY when the site has been added to the Home
 *    Screen. In a normal Safari tab `PushManager` is absent — say so, do not just
 *    show a dead button.
 */

export type PushClientState =
  | { state: "unsupported"; reason: string }
  | { state: "ios_needs_home_screen"; reason: string }
  | { state: "setup_required"; reason: string }
  | { state: "denied"; reason: string }
  | { state: "subscribed" }
  | { state: "available" };

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  return iOS && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return legacy === true || window.matchMedia("(display-mode: standalone)").matches;
}

/** Returns the raw ArrayBuffer: `applicationServerKey` takes a BufferSource. */
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return buffer;
}

function keyToBase64Url(key: ArrayBuffer | null): string {
  if (!key) return "";
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export type PushServerStatus = {
  state: "ready" | "setup_required";
  publicKey?: string;
  detail?: string;
  subscribed?: boolean;
};

/** Ask the server whether push is configured and whether this browser is registered. */
export async function fetchPushStatus(): Promise<PushServerStatus> {
  const response = await fetch("/api/push", { credentials: "same-origin" });
  if (!response.ok) return { state: "setup_required", detail: "Could not read push status." };
  return (await response.json()) as PushServerStatus;
}

/** What the preferences UI should render before the user clicks anything. */
export async function readPushClientState(): Promise<PushClientState> {
  if (typeof window === "undefined") return { state: "unsupported", reason: "No browser context." };
  if (!("serviceWorker" in navigator)) {
    return { state: "unsupported", reason: "This browser has no service worker support." };
  }
  if (!("PushManager" in window)) {
    if (isIosSafari() && !isStandalone()) {
      return {
        state: "ios_needs_home_screen",
        reason: "On iPhone and iPad, add Vantage to your Home Screen first — Safari only allows push from an installed app.",
      };
    }
    return { state: "unsupported", reason: "This browser cannot receive push notifications." };
  }
  if (Notification.permission === "denied") {
    return {
      state: "denied",
      reason: "Notifications are blocked for this site in your browser settings.",
    };
  }

  const status = await fetchPushStatus();
  if (status.state !== "ready" || !status.publicKey) {
    return {
      state: "setup_required",
      reason: status.detail ?? "Push is not configured on this server yet.",
    };
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? { state: "subscribed" } : { state: "available" };
}

export type SubscribeResult =
  | { ok: true; endpoint: string }
  | { ok: false; state: PushClientState["state"]; reason: string };

/**
 * Prompt for permission and register this browser. Call from a click handler —
 * browsers require a user gesture for `Notification.requestPermission()`.
 */
export async function subscribeToPush(orgId?: string): Promise<SubscribeResult> {
  const initial = await readPushClientState();
  if (initial.state !== "available" && initial.state !== "subscribed") {
    return { ok: false, state: initial.state, reason: initial.reason };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      state: "denied",
      reason: "Notification permission was not granted.",
    };
  }

  const status = await fetchPushStatus();
  if (status.state !== "ready" || !status.publicKey) {
    return {
      ok: false,
      state: "setup_required",
      reason: status.detail ?? "Push is not configured on this server yet.",
    };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(status.publicKey),
    }));

  const response = await fetch("/api/push", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: keyToBase64Url(subscription.getKey("p256dh")),
      auth: keyToBase64Url(subscription.getKey("auth")),
      orgId: orgId ?? null,
    }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      state: "unsupported",
      reason: error.error ?? "Could not save this device on the server.",
    };
  }
  return { ok: true, endpoint: subscription.endpoint };
}

/** Unregister this browser: drop the server row first, then the local subscription. */
export async function unsubscribeFromPush(): Promise<{ ok: boolean }> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { ok: false };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { ok: true };
  await fetch("/api/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
  return { ok: true };
}
