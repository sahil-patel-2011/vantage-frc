/* global self, caches, clients */
/**
 * Vantage offline app shell (CD #10).
 *
 * - Precache `/offline` so cold no-signal navigations (incl. PWA start) boot.
 * - Allowlisted shell routes: network-first document cache, then `/offline`.
 * - Other navigations: network-only; on failure fall back to `/offline`
 *   (never cache non-shell auth HTML).
 * - Never intercept /api/* or Next RSC/Flight requests.
 * - Static assets only in the asset cache. Scout outbox stays in IndexedDB.
 *
 * Route allowlist mirror: apps/web/lib/offline/shell-routes.ts
 */
// Bump both on any release that changes the shell or its assets: `activate` deletes
// every cache whose key is not one of these two, so a version bump is what forces a
// returning installed client off the previous release's cached UI.
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const ASSET_CACHE = "vantage-assets-" + BUILD;
const SHELL_CACHE = "vantage-shell-" + BUILD;
const SHELL_URL = "/offline";

const PRECACHE = ["/manifest.webmanifest", "/icon.svg", SHELL_URL];

const SHELL_ROUTES = [
  "/offline",
  "/offline-shell",
  "/scouting",
  "/schedule",
  "/competition",
  "/calendar",
  "/team/calendar",
  "/team",
  "/todos",
  "/tasks",
  "/logistics",
  "/build",
  "/files",
  "/docs",
  "/dashboard",
  "/strategy",
  "/hours",
  "/messages",
  "/match-checklist",
  "/match-notes-timeline",
  "/pit",
  "/video-analysis",
  "/assembly-manual",
  "/packing",
  "/batteries",
];

function isShellPath(pathname) {
  return SHELL_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

function isRscRequest(request) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/x-component")) return true;
  if (request.headers.get("RSC") === "1") return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  if (request.headers.get("Next-Router-Prefetch")) return true;
  return false;
}

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?)$/i.test(
      pathname,
    )
  );
}

function hardOfflineHtml() {
  return new Response(
    "<!doctype html><title>Offline</title><p>Vantage is offline. Open the app once online to cache the scout shell.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function matchShellFallback() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(SHELL_URL, { ignoreSearch: true })) || hardOfflineHtml();
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(new URL(request.url).pathname));
    if (cached) return cached;
    return matchShellFallback();
  }
}

async function navigateWithShellFallback(request) {
  try {
    return await fetch(request);
  } catch {
    return matchShellFallback();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== ASSET_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WARM_SHELL") {
    event.waitUntil(precacheShell());
  }
});

/* ---------------------------------------------------------------------------
 * Web Push (the "your match is up in 7 minutes" ping).
 *
 * Payload contract — server side is apps/web/lib/push/payload.ts:
 *   { title, body?, url?, tag?, type?, urgent? }
 * `url` is always a same-origin path (the server strips anything else).
 * A push MUST show a notification: browsers revoke the subscription from origins
 * that receive a push and stay silent, so the catch path still shows something.
 * ------------------------------------------------------------------------- */

const PUSH_FALLBACK_TITLE = "Vantage";

function readPushPayload(event) {
  if (!event.data) return { title: PUSH_FALLBACK_TITLE };
  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    const text = event.data.text();
    if (text) return { title: PUSH_FALLBACK_TITLE, body: text };
  }
  return { title: PUSH_FALLBACK_TITLE };
}

function pushNotificationOptions(payload) {
  const urgent = payload.urgent === true;
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: {
      url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/",
      type: typeof payload.type === "string" ? payload.type : "",
    },
    // Competition-day pings stay on screen until someone acts on them.
    requireInteraction: urgent,
  };
  if (typeof payload.tag === "string" && payload.tag) {
    options.tag = payload.tag;
    // Same tag = a newer version of the same thing; buzz again rather than replace silently.
    options.renotify = true;
  }
  if (urgent) options.vibrate = [180, 80, 180];
  return options;
}

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : PUSH_FALLBACK_TITLE;
  event.waitUntil(self.registration.showNotification(title, pushNotificationOptions(payload)));
});

/**
 * Browsers rotate a subscription on their own schedule. Re-register with the same
 * application server key and tell the server, otherwise the device goes quiet with
 * nothing in the UI to explain why. Best-effort: failures leave the old row to be
 * pruned by the next 404/410 from the push service.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldSubscription = event.oldSubscription;
  const applicationServerKey =
    (event.newSubscription && event.newSubscription.options.applicationServerKey) ||
    (oldSubscription && oldSubscription.options.applicationServerKey);
  event.waitUntil(
    (async () => {
      try {
        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));
        const toBase64Url = (buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return self.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        };
        await fetch("/api/push", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            p256dh: toBase64Url(subscription.getKey("p256dh")),
            auth: toBase64Url(subscription.getKey("auth")),
            previousEndpoint: oldSubscription ? oldSubscription.endpoint : null,
          }),
        });
      } catch {
        // Nothing useful to do inside a service worker; the next visit re-subscribes.
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Reuse the open app window: navigate it, then bring it forward.
        if ("navigate" in client) {
          const navigated = await client.navigate(target.href).catch(() => client);
          return (navigated || client).focus();
        }
        return client.focus();
      }
      return clients.openWindow(target.href);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (isRscRequest(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      isShellPath(url.pathname)
        ? networkFirstShell(request)
        : navigateWithShellFallback(request),
    );
    return;
  }

  if (!isStaticAssetPath(url.pathname)) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (url.pathname.startsWith("/_next/static/") && cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    }),
  );
});
