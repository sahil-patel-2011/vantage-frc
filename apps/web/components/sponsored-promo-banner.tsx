"use client";

import { useEffect, useState } from "react";

type PromoPayload = {
  eligible?: boolean;
  endsAt?: string;
  teamNumber?: number | null;
  reason?: string | null;
  message?: string;
  error?: string;
};

/**
 * Surfaces team 1111 sponsored-promo state (active window or expired reminder).
 * Only renders for the promo team or when the API returns a promo-related message.
 * Expiry is AI-pool only — never used to lock out non-AI product surfaces.
 */
export function SponsoredPromoBanner({
  orgId,
  className,
}: {
  orgId: string;
  className?: string;
}) {
  const [payload, setPayload] = useState<PromoPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/organizations/sponsored-promo?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as PromoPayload;
        if (!cancelled) setPayload(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!payload?.message) return null;
  // Hide noise for unrelated teams (wrong_team / no_team_number).
  if (
    !payload.eligible &&
    payload.reason !== "promo_expired" &&
    payload.reason !== "keys_missing"
  ) {
    return null;
  }

  const expired = payload.reason === "promo_expired";
  const tone = expired ? "warn" : "info";

  return (
    <aside
      className={`sponsored-promo-banner sponsored-promo-banner--${tone}${className ? ` ${className}` : ""}`}
      role="status"
      style={{
        margin: "0 0 0.75rem",
        padding: "0.65rem 0.85rem",
        border: "1px solid var(--app-border, #c9d0da)",
        background: expired ? "var(--app-warn-bg, #fff7ed)" : "var(--app-surface-2, #f4f7fb)",
        color: "var(--app-text, #1a2332)",
        fontSize: "0.9rem",
        lineHeight: 1.45,
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.2rem" }}>
        {expired ? "Sponsored AI ended" : "Sponsored promo AI"}
      </strong>
      <span>{payload.message}</span>
      {expired ? (
        <div style={{ marginTop: "0.45rem" }}>
          <a className="app-button secondary" href={`/team/ai-keys?orgId=${encodeURIComponent(orgId)}`}>
            Add AI API keys
          </a>
        </div>
      ) : null}
    </aside>
  );
}
