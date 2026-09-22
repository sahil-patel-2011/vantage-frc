"use client";

import { useEffect, useState } from "react";
import type { ClientHubAccessRow } from "./hub-access-filter";
import { requestMe } from "./me-request";

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
    void requestMe()
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setProfile({ ready: true, hubAccess: null, sponsorsAllowed: null });
          return;
        }
        const payload = data as MeAccessPayload | null;
        setProfile({
          ready: true,
          hubAccess: Array.isArray(payload?.hubAccess) ? payload.hubAccess : null,
          sponsorsAllowed: payload?.sponsorsAllowed ?? null,
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
