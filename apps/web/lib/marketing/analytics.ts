"use client";

declare global {
  interface Window {
    plausible?: (event: string) => void;
  }
}

export type MarketingEvent = "hero_cta" | "section_cta" | "waitlist_success";

/** Fixed event names prevent contact details from entering analytics. */
export function track(event: MarketingEvent) {
  try {
    window.plausible?.(event);
  } catch {
    // Analytics is optional and must never interrupt the waitlist.
  }
}
