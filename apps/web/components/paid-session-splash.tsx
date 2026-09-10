"use client";

import { useEffect, useRef, useState } from "react";
import { FEATURE_API_TIMEOUT_MS } from "../lib/nav/resolve-org";
import {
  isPayingOrgEntitlement,
  paidSplashStorageKey,
  shouldShowPaidSessionSplash,
} from "../lib/paid-plan";
import "./paid-session-splash.css";

type MeSplashPayload = {
  authenticated?: boolean;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  paidOrg?: boolean;
  planCode?: string | null;
  planStatus?: string | null;
};

const AUTO_DISMISS_MS = 2000;
const REDUCED_MOTION_DISMISS_MS = 400;
const EXIT_MS = 320;

function readAlreadyShown(orgId: string): boolean {
  try {
    return sessionStorage.getItem(paidSplashStorageKey(orgId)) === "1";
  } catch {
    return true;
  }
}

function markShown(orgId: string) {
  try {
    sessionStorage.setItem(paidSplashStorageKey(orgId), "1");
  } catch {
    // sessionStorage unavailable — treat as shown so we never block the app
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function PaidSessionSplash() {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const dismissing = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dismiss() {
    if (dismissing.current) return;
    dismissing.current = true;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setPhase("out");
    exitTimer.current = setTimeout(() => setVisible(false), prefersReducedMotion() ? 0 : EXIT_MS);
  }

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/me", {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => (response.ok ? ((await response.json()) as MeSplashPayload) : null))
      .then((data) => {
        if (cancelled || !data?.authenticated || !data.orgId) return;

        const paidOrg =
          typeof data.paidOrg === "boolean"
            ? data.paidOrg
            : isPayingOrgEntitlement({ planCode: data.planCode, status: data.planStatus });

        const alreadyShown = readAlreadyShown(data.orgId);
        if (
          !shouldShowPaidSessionSplash({
            paidOrg,
            teamNumber: data.teamNumber,
            orgId: data.orgId,
            alreadyShown,
          })
        ) {
          return;
        }

        markShown(data.orgId);
        setTeamNumber(data.teamNumber ?? null);
        setOrgName(data.orgName ?? null);
        setVisible(true);
        setPhase("in");

        const delay = prefersReducedMotion() ? REDUCED_MOTION_DISMISS_MS : AUTO_DISMISS_MS;
        autoTimer.current = setTimeout(() => dismiss(), delay);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (autoTimer.current) clearTimeout(autoTimer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // dismiss is stable enough for mount-only fetch; intentional once-per-mount
     
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, [visible]);

  if (!visible || teamNumber == null) return null;

  return (
    <button
      type="button"
      className="paid-splash"
      data-phase={phase}
      onClick={() => dismiss()}
      aria-label={`Welcome, team ${teamNumber}. Tap to continue.`}
    >
      <span className="paid-splash-inner">
        <p className="paid-splash-brand">Vantage</p>
        <p className="paid-splash-number">{teamNumber}</p>
        {orgName ? <p className="paid-splash-org">{orgName}</p> : null}
        <p className="paid-splash-hint">Tap to continue</p>
      </span>
    </button>
  );
}
