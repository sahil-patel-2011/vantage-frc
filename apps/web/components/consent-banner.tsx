"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  analyticsAllowed,
  consentDecisionPending,
  CONSENT_OPEN_EVENT,
  ensureAnalyticsListeners,
  readConsentState,
  trackPageView,
  writeConsentChoice,
} from "../lib/product-analytics/client";
import { type ConsentChoice } from "../lib/product-analytics/consent";
import { ANALYTICS_BANNER_COPY } from "../lib/product-analytics/copy";
import "./consent-banner.css";

/**
 * The analytics consent banner, plus the route-change page-view tracker it
 * gates. One mount in the root layout covers both, which is deliberate: the
 * thing that collects and the thing that asks permission live in the same
 * component, so it is not possible to ship the collector without the question.
 *
 * Behaviour:
 *   - Renders nothing until mounted, because the answer lives in a cookie and
 *     the server has no business guessing it during SSR.
 *   - Asks once. A decline is a real answer and the banner goes away.
 *   - Reopens on `/privacy#analytics` (the policy's own analytics section) or
 *     when any surface dispatches `vantage:analytics-consent-open`, which is
 *     how the answer stays changeable later without a settings page of its own.
 *   - Page views are only recorded while consent is granted; the tracker
 *     re-reads the cookie on every call, so this never drifts.
 */

const REOPEN_HASH = "#analytics";

export function ConsentBanner() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  const syncFromCookie = useCallback(() => {
    const state = readConsentState();
    setChoice(state?.choice ?? null);
    return state;
  }, []);

  useEffect(() => {
    setMounted(true);
    ensureAnalyticsListeners();
    syncFromCookie();
    setAsking(consentDecisionPending());
  }, [syncFromCookie]);

  // Reopening: the privacy policy's analytics anchor, or an explicit event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openFromHash = () => {
      if (window.location.hash === REOPEN_HASH) {
        syncFromCookie();
        setReopened(true);
        setAsking(true);
      }
    };
    const openFromEvent = () => {
      syncFromCookie();
      setReopened(true);
      setAsking(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener(CONSENT_OPEN_EVENT, openFromEvent);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener(CONSENT_OPEN_EVENT, openFromEvent);
    };
  }, [syncFromCookie]);

  // Page views. `trackPageView` is a no-op without consent — the guard lives in
  // one place rather than being re-implemented at every call site.
  useEffect(() => {
    if (!mounted || !pathname) return;
    if (!analyticsAllowed()) return;
    trackPageView(pathname);
  }, [mounted, pathname]);

  const decide = useCallback(
    (next: ConsentChoice) => {
      writeConsentChoice(next);
      setChoice(next);
      setAsking(false);
      setReopened(false);
      if (next === "granted" && typeof window !== "undefined") {
        // Record the page they were on when they said yes, and nothing earlier.
        trackPageView(window.location.pathname);
      }
    },
    [],
  );

  if (!mounted || !asking) return null;

  const copy = ANALYTICS_BANNER_COPY;
  const current = choice === "granted" ? copy.currentGranted : choice === "denied" ? copy.currentDenied : null;

  return (
    <section className="consent-banner" role="region" aria-label={copy.ariaLabel} data-soft-ui="consent-banner">
      <div className="consent-banner-card">
        <div className="consent-banner-text">
          <h2 className="consent-banner-title">{copy.title}</h2>
          <p className="consent-banner-lead">{copy.lead}</p>
          <p className="consent-banner-detail">{copy.detail}</p>
          <p className="consent-banner-detail">{copy.reassurance}</p>
          {reopened && current ? <p className="consent-banner-current">{current}</p> : null}
        </div>
        <div className="consent-banner-actions">
          <button type="button" className="consent-banner-btn consent-banner-btn--accept" onClick={() => decide("granted")}>
            {copy.acceptLabel}
          </button>
          <button type="button" className="consent-banner-btn consent-banner-btn--decline" onClick={() => decide("denied")}>
            {copy.declineLabel}
          </button>
          <a className="consent-banner-link" href={copy.detailsHref}>
            {copy.detailsLabel}
          </a>
        </div>
      </div>
    </section>
  );
}

export default ConsentBanner;
