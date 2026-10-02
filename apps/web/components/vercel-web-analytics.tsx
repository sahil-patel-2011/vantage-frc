"use client";

import { useSyncExternalStore } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { analyticsAllowed, CONSENT_CHANGED_EVENT } from "../lib/product-analytics/client";
import { sanitizeVercelPageView } from "../lib/product-analytics/vercel-events";

function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.removeEventListener("focus", onChange);
  };
}
function beforeSend(event: BeforeSendEvent) {
  // Re-read consent for every event, including revocation in another tab.
  return sanitizeVercelPageView(event, analyticsAllowed());
}
const serverSnapshot = () => false;

export function VercelWebAnalytics() {
  const enabled = useSyncExternalStore(subscribe, analyticsAllowed, serverSnapshot);
  return enabled ? <Analytics beforeSend={beforeSend} /> : null;
}
