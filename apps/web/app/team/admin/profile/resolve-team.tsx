"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState } from "../../../../components/ui";
import { fetchActiveOrgId, withPersistedOrgSearch } from "../../../../lib/nav/resolve-org";

/**
 * Opened without ?orgId (a bookmark, a typed address): find the team the person is working in,
 * the way Team admin and Team security do, instead of asking them to choose one they already have.
 */
export function ResolveTeamProfile() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchActiveOrgId().then((orgId) => {
      if (cancelled) return;
      if (orgId) {
        window.location.replace(`${window.location.pathname}${withPersistedOrgSearch(window.location.search, orgId)}`);
      } else {
        setMissing(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing) {
    return <EmptyState soft title="Opening your team…" description="Finding the team you're working in." aria-busy />;
  }
  return (
    <EmptyState soft badge="Needs setup" badgeTone="setup" title="Choose your team" description="Pick the team whose profile you want to change.">
      <Button as="a" variant="primary" href="/workspace">
        Choose your team
      </Button>
    </EmptyState>
  );
}
