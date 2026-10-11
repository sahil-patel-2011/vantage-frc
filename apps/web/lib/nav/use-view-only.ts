"use client";

import { useEffect, useState } from "react";
import { requestMe } from "./me-request";
import { viewOnlyFromMe } from "./view-only";

/**
 * True once `/api/me` says the person is View only on `orgId`. Starts false, so a
 * page renders as it always did and only swaps its write buttons for the View
 * only note when the answer arrives (one shared `/api/me` per page load).
 */
export function useViewOnly(orgId: string | null | undefined): boolean {
  const [viewOnly, setViewOnly] = useState(false);
  useEffect(() => {
    if (!orgId) {
      setViewOnly(false);
      return;
    }
    let cancelled = false;
    void requestMe(orgId)
      .then(({ ok, data }) => {
        if (!cancelled) setViewOnly(ok && viewOnlyFromMe(data, orgId));
      })
      .catch(() => {
        if (!cancelled) setViewOnly(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);
  return viewOnly;
}
