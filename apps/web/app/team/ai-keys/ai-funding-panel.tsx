"use client";

import { useEffect, useState } from "react";

/**
 * Tells a team what is currently paying for its AI.
 *
 * Renders nothing when neither applies, which is the normal case for a team on its own
 * keys — an always-present panel saying "no credits, no grant" would be noise on the
 * screen where they just configured a working key.
 */
type Funding = {
  credits: { onPlan: boolean; granted: number; spent: number; balance: number };
  grants: Array<{ accessKind: string; endsAt: string; note: string }>;
  weights: Array<{ requestKind: string; credits: number }>;
};

const ACCESS_LABELS: Record<string, string> = {
  platform_relay: "a platform-hosted relay",
  hosted_platform: "platform-hosted keys",
  sponsored_pool: "the sponsored provider pool",
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function AiFundingPanel({ orgId }: { orgId: string | null }) {
  const [funding, setFunding] = useState<Funding | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/team/ai-funding?orgId=${encodeURIComponent(orgId)}`);
        if (!response.ok) return;
        const data = (await response.json()) as Funding;
        if (!cancelled) setFunding(data);
      } catch {
        // Silent: this panel is supplementary to key setup, never the reason the page
        // is open, so a failure here must not shout over the actual task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!funding) return null;
  const { credits, grants, weights } = funding;
  if (!credits.onPlan && grants.length === 0) return null;

  const chat = weights.find((weight) => weight.requestKind === "chat")?.credits ?? 1;
  const agentic = weights.find((weight) => weight.requestKind === "agentic")?.credits ?? 4;

  return (
    <section className="app-card soft-panel ai-funding-panel" aria-labelledby="ai-funding-title">
      <h2 id="ai-funding-title">How your AI is funded</h2>

      {grants.map((grant) => {
        const days = daysUntil(grant.endsAt);
        return (
          <p key={grant.endsAt} className="ai-funding-grant" role="note">
            <strong>Your AI is running on {ACCESS_LABELS[grant.accessKind] ?? grant.accessKind}.</strong>{" "}
            {/* The end date is the point: this is borrowed capacity, and a team that
                does not know it expires cannot plan to replace it. */}
            This was lent to your team by the platform and ends{" "}
            {new Date(grant.endsAt).toLocaleDateString()}
            {days > 0 ? ` (${days} day${days === 1 ? "" : "s"} left)` : ""}. Add your own key
            below any time — your keys always take priority over a loan.
            {grant.note ? ` ${grant.note}` : ""}
          </p>
        );
      })}

      {credits.onPlan ? (
        <>
          <div className="ai-funding-metrics">
            <div>
              <strong>{credits.balance.toLocaleString()}</strong>
              <span>requests left</span>
            </div>
            <div>
              <strong>{credits.spent.toLocaleString()}</strong>
              <span>used</span>
            </div>
            <div>
              <strong>{credits.granted.toLocaleString()}</strong>
              <span>granted</span>
            </div>
          </div>
          <p className="app-muted">
            A chat message costs {chat} credit{chat === 1 ? "" : "s"}; an agent run costs{" "}
            {agentic}, because it makes many model calls for one action. Requests on your own
            key never spend credits.
          </p>
        </>
      ) : null}
    </section>
  );
}
