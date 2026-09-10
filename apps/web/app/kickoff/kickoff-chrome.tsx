"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { kickoffNextActions } from "../../lib/kickoff-related";

export function useHubEmbed(): "build" | null {
  const [embed, setEmbed] = useState<"build" | null>(null);
  useEffect(() => {
    if (window.location.pathname.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
}

export function NextActionsPanel({
  orgId,
  seasonYear,
  hasIntelligence,
  actionCount,
  priorityCount,
  openRuleCount,
  cadJobId,
}: {
  orgId?: string | null;
  seasonYear: number;
  hasIntelligence: boolean;
  actionCount: number;
  priorityCount: number;
  openRuleCount: number;
  cadJobId?: string | null;
}) {
  const actions = kickoffNextActions({
    orgId,
    seasonYear,
    hasIntelligence,
    actionCount,
    priorityCount,
    openRuleCount,
    cadJobId,
  });
  if (!actions.length) return null;
  return (
    <section className="kick-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
