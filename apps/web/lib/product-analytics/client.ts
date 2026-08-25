"use client";

/**
 * The browser half of product analytics.
 *
 * Everything in here is a no-op unless the consent cookie says "granted" at the
 * current consent version. That is not a flag checked once at startup — it is
 * re-read from `document.cookie` on every single call, so revoking consent in
 * one tab silently stops collection in the others too.
 *
 * It also never blocks the UI: `trackPageView` / `trackFeatureAction` append to
 * an in-memory array and return. Delivery happens on a timer, or on
 * `visibilitychange` / `pagehide` via `navigator.sendBeacon`, which is the one
 * send the browser will finish after the page is gone.
 */

import {
  ANALYTICS_CONSENT_COOKIE,
  consentCookieAttributes,
  hasAnalyticsConsent,
  needsConsentDecision,
  parseConsent,
  serializeConsent,
  type ConsentChoice,
  type ConsentState,
} from "./consent";
import { deviceClassFromWidth, type DeviceClass, type ProductEventInput, type ProductEventMeta } from "./events";
import { createTracker, type FlushReason, type Tracker } from "./tracker";

export const ANALYTICS_ENDPOINT = "/api/analytics/events";

/** Fired on window whenever the stored choice changes, or when a surface asks to reopen the chooser. */
export const CONSENT_CHANGED_EVENT = "vantage:analytics-consent-changed";
export const CONSENT_OPEN_EVENT = "vantage:analytics-consent-open";

function browser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function rawConsentCookie(): string | null {
  if (!browser()) return null;
  const match = new RegExp(`(?:^|; )${ANALYTICS_CONSENT_COOKIE}=([^;]*)`).exec(document.cookie);
  const value = match?.[1];
  if (value === undefined) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The stored choice, or null when nobody has answered yet. */
export function readConsentState(): ConsentState | null {
  return parseConsent(rawConsentCookie());
}

/** The one question the tracker asks. Server-side rendering always answers no. */
export function analyticsAllowed(): boolean {
  return hasAnalyticsConsent(rawConsentCookie());
}

/** True while the banner still owes the user a question. A decline ends it. */
export function consentDecisionPending(): boolean {
  return needsConsentDecision(rawConsentCookie());
}

/**
 * Record a choice. Writing "denied" is as real a write as "granted" — the
 * banner has to be able to stop asking after a no.
 */
export function writeConsentChoice(choice: ConsentChoice): void {
  if (!browser()) return;
  const secure = window.location.protocol === "https:";
  document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${serializeConsent(choice)}; ${consentCookieAttributes(secure)}`;
  deliverySuspended = false;
  if (choice === "denied") {
    // Drop anything already queued rather than letting a timer deliver it.
    getTracker().flush("manual");
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: { choice } }));
  } catch {
    // CustomEvent is universally available; a failure here is not worth a throw.
  }
}

/** Ask whatever consent UI is mounted to show itself again. */
export function openConsentChooser(): void {
  if (!browser()) return;
  try {
    window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
  } catch {
    // Non-fatal by design.
  }
}

function currentDeviceClass(): DeviceClass {
  if (!browser()) return "unknown";
  return deviceClassFromWidth(window.innerWidth);
}

/**
 * Set once the server tells us this browser has nothing to send — signed out,
 * or consent refused server-side. Stops us hammering an endpoint that is
 * correctly saying no. Cleared on reload and whenever the choice changes.
 */
let deliverySuspended = false;

function deliver(events: ProductEventInput[], reason: FlushReason): void {
  if (!browser() || !events.length || deliverySuspended) return;
  const body = JSON.stringify({ events });
  // On unload only sendBeacon is guaranteed to be allowed to finish.
  if (reason === "unload" && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    } catch {
      // Fall through to fetch.
    }
  }
  try {
    void fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    })
      .then((response) => {
        // 401 = signed out, 403 = the server does not see consent. Either way
        // this browser has nothing to send; stop asking until the next load.
        if (response.status === 401 || response.status === 403) deliverySuspended = true;
      })
      .catch(() => {
        // A dropped analytics batch is an acceptable outcome. Silence is correct.
      });
  } catch {
    // Same.
  }
}

let tracker: Tracker | null = null;
let listenersAttached = false;

function getTracker(): Tracker {
  if (!tracker) {
    tracker = createTracker({
      hasConsent: analyticsAllowed,
      send: deliver,
      deviceClass: currentDeviceClass,
      setTimer: (fn, ms) => (browser() ? window.setTimeout(fn, ms) : null),
      clearTimer: (handle) => {
        if (browser() && typeof handle === "number") window.clearTimeout(handle);
      },
    });
  }
  return tracker;
}

/**
 * Attach the unload flushes exactly once. Safe to call from any component
 * mount; later calls do nothing.
 */
export function ensureAnalyticsListeners(): void {
  if (!browser() || listenersAttached) return;
  listenersAttached = true;
  const flushOnHide = () => {
    if (document.visibilityState === "hidden") getTracker().flush("unload");
  };
  document.addEventListener("visibilitychange", flushOnHide);
  window.addEventListener("pagehide", () => getTracker().flush("unload"));
}

/** A route was viewed. `path` is normalised before it leaves the browser. */
export function trackPageView(path: string, meta?: ProductEventMeta): void {
  getTracker().track("page_view", path, meta);
}

/**
 * A deliberate action inside a feature.
 *
 * `feature` and `action` are short labels chosen in code, never text a user
 * typed — anything that does not look like a label is dropped by `sanitizeMeta`
 * before it can be queued.
 */
export function trackFeatureAction(
  feature: string,
  action: string,
  options?: { path?: string; meta?: ProductEventMeta },
): void {
  const path = options?.path ?? (browser() ? window.location.pathname : "/");
  getTracker().track("feature_action", path, { ...(options?.meta ?? {}), feature, action });
}

/** Flush now (used when a surface knows the user is about to leave). */
export function flushAnalytics(): void {
  getTracker().flush("manual");
}

/** Test seam: forget the singleton so a new consent state is picked up cleanly. */
export function resetAnalyticsClientForTests(): void {
  tracker = null;
  listenersAttached = false;
  deliverySuspended = false;
}
