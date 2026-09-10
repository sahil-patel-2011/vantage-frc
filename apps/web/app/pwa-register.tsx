"use client";

import { useEffect } from "react";

/**
 * Register the service worker and warm `/offline` so cold no-signal loads can
 * boot the shell.
 *
 * Production only. In development the worker is actively harmful: `next dev`
 * serves chunks under stable, unhashed names, and the worker caches
 * `/_next/static/` cache-first — so after any edit the browser kept running
 * the previous bundle until someone unregistered the worker by hand. It cost a
 * verification pass on this repo before the cause was found. Set
 * NEXT_PUBLIC_PWA_DEV=1 to opt in while working on the worker itself. In
 * development any leftover registration from a production visit on the same
 * origin is removed for the same reason.
 */
const ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_PWA_DEV === "1";
const BUILD_ID =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || "dev";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!ENABLED) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined);
      return;
    }
    void navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`)
      .then((registration) => {
        void registration.update().catch(() => undefined);
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        worker?.postMessage({ type: "WARM_SHELL" });
        void fetch("/offline", { credentials: "same-origin" }).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);
  return null;
}
