"use client";

import { useEffect, useState } from "react";
import { productForHost, vantageOrigin } from "./products";

/**
 * Where "Join the waitlist" goes. The waitlist lives on Vantage's home page; on the Scouting
 * host "/" is Scouting's sign-in, so the relative link looped a newcomer back to the same page.
 */
export function useWaitlistHref(): string {
  const [href, setHref] = useState("/#waitlist");
  useEffect(() => {
    if (productForHost(window.location.host) !== "scouting") return;
    const origin = vantageOrigin();
    if (origin) setHref(`${origin}/#waitlist`);
  }, []);
  return href;
}
