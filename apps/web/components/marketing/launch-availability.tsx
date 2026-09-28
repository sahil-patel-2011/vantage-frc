"use client";

import { useEffect, useState } from "react";

export const EARLY_ACCESS_HREF = "mailto:vantagefrc@gmail.com?subject=Vantage%20early%20access&body=Team%20number%3A%20%0ATeam%20name%3A%20%0AYour%20role%3A%20%0AWhat%20would%20you%20like%20to%20try%3F%20";

/** The live auth gate, rather than a cached marketing build, decides whether signup is open. */
let statusRequest: { at: number; result: Promise<boolean> } | null = null;
function signupOpen(): Promise<boolean> {
  if (!statusRequest || Date.now() - statusRequest.at > 10_000) {
    statusRequest = { at: Date.now(), result: fetch("/api/auth/status", { cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then((data: { publicSignup?: boolean } | null) => data?.publicSignup === true).catch(() => false) };
  }
  return statusRequest.result;
}

export function usePublicSignupOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      void signupOpen().then(value => { if (!cancelled) setOpen(value); });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); };
  }, []);
  return open;
}

export function LaunchAvailability() {
  const open = usePublicSignupOpen();
  return <p className="lux-hero-note" data-testid="launch-availability">
    {open ? <>Team signup is open. <a href="/signin">Create your account</a></>
      : <>Team signup is planned for <strong>December 1, 2026</strong>. <a href={EARLY_ACCESS_HREF}>Contact us for early access</a>.</>}
  </p>;
}
