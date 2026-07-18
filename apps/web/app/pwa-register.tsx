"use client";

import { useEffect } from "react";

/** Register SW and warm `/offline` so cold no-signal loads can boot the shell. */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js")
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
