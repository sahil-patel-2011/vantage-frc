"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyticsAllowed,
  consentAlreadyAsked,
  consentDecisionPending,
  CONSENT_OPEN_EVENT,
  ensureAnalyticsListeners,
  markConsentAsked,
  readConsentState,
  trackPageView,
  writeConsentChoice,
} from "../lib/product-analytics/client";
import { ANALYTICS_CONSENT_VERSION, type ConsentChoice } from "../lib/product-analytics/consent";
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
 *   - Asks on one page. Shown and not answered, it is gone on the next page and
 *     on every later visit; nothing is recorded without a yes, so walking past
 *     it is as safe as declining.
 *   - Reopens on `/privacy#analytics` (the policy's own analytics section) or
 *     when any surface dispatches `vantage:analytics-consent-open`, which is
 *     how the answer stays changeable later without a settings page of its own.
 *   - Page views are only recorded while consent is granted; the tracker
 *     re-reads the cookie on every call, so this never drifts.
 */

const REOPEN_HASH = "#analytics";

/**
 * Pages where nobody is asked. The banner is about "your account … inside your team", which
 * is not true of a visitor reading the website or someone still signing in, and it covered
 * the one button those pages exist for. Nothing is recorded without an answer, so not
 * asking here records nothing. The privacy policy's #analytics link still opens it.
 */
const NO_ASK_PATHS = new Set(["/", "/pricing", "/workflow", "/for-teams", "/desktop", "/privacy", "/terms", "/signin", "/sign-in", "/invite", "/join-team", "/onboarding", "/offline"]);

function asksOn(pathname: string | null): boolean {
  if (!pathname) return false;
  // Pit TVs and kiosks run unattended: nobody is there to answer, and a banner over the
  // bottom third of the screen hides the match. They record nothing, so there is nothing to ask.
  if (pathname.startsWith("/display/")) return false;
  return !NO_ASK_PATHS.has(pathname) && !pathname.startsWith("/features");
}

export function ConsentBanner() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  // The page the question was first shown on. It stays up there and nowhere else.
  const [shownOn, setShownOn] = useState<string | null>(null);

  const syncFromCookie = useCallback(() => {
    const state = readConsentState();
    setChoice(state?.version === ANALYTICS_CONSENT_VERSION ? state.choice : null);
    return state;
  }, []);

  useEffect(() => {
    setMounted(true);
    ensureAnalyticsListeners();
    syncFromCookie();
    setAsking(consentDecisionPending() && !consentAlreadyAsked());
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
      clearClearance();
      if (next === "granted" && typeof window !== "undefined") {
        // Record the page they were on when they said yes, and nothing earlier.
        trackPageView(window.location.pathname);
      }
    },
    [],
  );

  const firstAsk = asksOn(pathname) && (shownOn === null || shownOn === pathname);
  const visible = mounted && asking && (reopened || firstAsk);

  // Remember the first showing, so the next page and the next visit are left alone.
  useEffect(() => {
    if (!visible || reopened || shownOn !== null || !pathname) return;
    setShownOn(pathname);
    markConsentAsked();
  }, [visible, reopened, shownOn, pathname]);

  /**
   * Give the page the height of the banner.
   *
   * The card is `position: fixed` so it survives scrolling, which meant it sat
   * on top of whatever was at the bottom of the screen. The wrapper is
   * `pointer-events: none`, so the page underneath still worked — but on a
   * calendar or a scouting form the bottom third of the screen was simply gone,
   * with no scroll position that revealed it. Publishing the measured height
   * as a custom property lets the shell pad itself by exactly that much, so
   * the question is asked without hiding anything.
   */
  const bannerRef = useRef<HTMLElement | null>(null);
  const clearClearance = useCallback(() => {
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("--consent-clearance");
  }, []);
  useEffect(() => {
    const node = bannerRef.current;
    if (!node) return;
    const publish = () => {
      const height = node.getBoundingClientRect().height;
      document.body.style.setProperty(
        "--consent-clearance",
        height > 0 ? `${Math.ceil(height)}px` : "0px",
      );
    };
    publish();
    // The card reflows when the "What we collect" disclosure opens, and on a
    // phone when the copy wraps to a different number of lines.
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      clearClearance();
    };
  }, [clearClearance, reopened, visible]);

  if (!visible) return null;

  const copy = ANALYTICS_BANNER_COPY;
  const current = choice === "granted" ? copy.currentGranted : choice === "denied" ? copy.currentDenied : null;

  return (
    <section
      className="consent-banner"
      role="region"
      aria-label={copy.ariaLabel}
      data-soft-ui="consent-banner"
      ref={bannerRef}
    >
      <div className="consent-banner-card">
        <div className="consent-banner-text">
          <h2 className="consent-banner-title">{copy.title}</h2>
          <p className="consent-banner-lead">{copy.lead}</p>
          {/* The full list and the "no costs nothing" promise, one tap away so the card stays small. */}
          <details className="consent-banner-more" open={reopened}>
            <summary data-disclosure>{copy.detailsLabel}</summary>
            <p className="consent-banner-detail">{copy.detail}</p>
            <p className="consent-banner-detail">{copy.reassurance}</p>
          </details>
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
            Privacy policy
          </a>
        </div>
      </div>
    </section>
  );
}

export default ConsentBanner;
