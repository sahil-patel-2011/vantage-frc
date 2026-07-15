"use client";

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
  }
}

export type MarketingEvent = "hero_cta" | "section_cta" | "waitlist_success";

/** No user values are accepted, preventing accidental PII from entering analytics. */
export function track(event: MarketingEvent) {
  try {
    window.plausible?.(event);
  } catch {
    // Analytics is optional and must never interrupt the waitlist.
  }
}
