import type { BeforeSendEvent } from "@vercel/analytics/next";
import { normalizePath } from "./events";

/** Vercel receives route-level page views, never app identities or custom content. */
export function sanitizeVercelPageView(event: BeforeSendEvent, allowed: boolean): BeforeSendEvent | null {
  if (!allowed || event.type !== "pageview") return null;
  try {
    const url = new URL(event.url);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return { type: "pageview", url: `${url.origin}${normalizePath(url.pathname)}` };
  } catch { return null; }
}
