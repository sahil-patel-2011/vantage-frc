"use client";

import { useEffect, useState } from "react";
import "./ai-credit-line.css";

/**
 * "Vantage gave your team $10 of AI credit · $3.20 used", for the team's AI settings and the AI
 * page. Renders nothing when the team has no credit from Vantage (or before migration 0727), so
 * it can sit on any team page. Reads /api/ai-credit, which never carries a key.
 */

type CreditPayload = {
  state: "active" | "none";
  line: string | null;
  usedUp: boolean;
  totalUsd: number;
  usedUsd: number;
  remainingUsd: number;
  gifts: Array<{ giftId: string; familyLabel: string; expiresAt: string | null; note: string | null; active: boolean }>;
};

export function AiCreditLine({ orgId, className }: { orgId: string | null | undefined; className?: string }) {
  const [credit, setCredit] = useState<CreditPayload | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    fetch(`/api/ai-credit?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CreditPayload>) : null))
      .then((body) => {
        if (!cancelled) setCredit(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!credit || credit.state !== "active" || !credit.line) return null;
  const percent = credit.totalUsd > 0 ? Math.min(100, Math.round((credit.usedUsd / credit.totalUsd) * 100)) : 0;
  const live = credit.gifts.filter((gift) => gift.active);
  const families = [...new Set(live.map((gift) => gift.familyLabel))].join(" and ");
  const ends = live.map((gift) => gift.expiresAt).filter((v): v is string => Boolean(v)).sort()[0];

  return (
    <section className={["ai-credit-line", className].filter(Boolean).join(" ")} aria-label="AI credit from Vantage" data-used-up={credit.usedUp || undefined}>
      <p>
        <strong>{credit.line}</strong>
      </p>
      <div
        className="ai-credit-line-track"
        role="progressbar"
        aria-label="AI credit used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="ai-credit-line-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="ai-credit-line-detail">
        {credit.usedUp
          ? "It's used up. Add your own AI key in AI settings to keep using Ask AI."
          : `Ask AI uses it for ${families}. It stops at the amount, so there's never a bill.${
              ends ? ` Ends ${new Date(ends).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.` : ""
            }`}
      </p>
    </section>
  );
}
