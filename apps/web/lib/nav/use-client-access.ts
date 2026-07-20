"use client";

import { useEffect, useState } from "react";
import type { ClientHubAccessRow } from "./hub-access-filter";

export type ClientAccessProfile = {
  ready: boolean;
  hubAccess: ClientHubAccessRow[] | null;
  sponsorsAllowed: boolean | null;
};

type MeAccessPayload = {
  authenticated?: boolean;
  hubAccess?: ClientHubAccessRow[] | null;
  sponsorsAllowed?: boolean | null;
};

/**
 * Soft-UI page/API gate inputs from `/api/me`.
 * Empty hubAccess ⇒ unrestricted (same contract as listMemberHubAccess).
 */
export function useClientAccessProfile(): ClientAccessProfile {
  const [profile, setProfile] = useState<ClientAccessProfile>({
    ready: false,
    hubAccess: null,
    sponsorsAllowed: null,
  });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) {
            setProfile({ ready: true, hubAccess: null, sponsorsAllowed: null });
          }
          return;
        }
        const data = (await response.json()) as MeAccessPayload;
        if (cancelled) return;
        setProfile({
          ready: true,
          hubAccess: Array.isArray(data.hubAccess) ? data.hubAccess : null,
          sponsorsAllowed: data.sponsorsAllowed ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setProfile({ ready: true, hubAccess: null, sponsorsAllowed: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
