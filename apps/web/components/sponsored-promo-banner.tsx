"use client";
import { Button } from "./ui";

import { useEffect, useState } from "react";

type PoolStatus = {
  configured?: string[];
  models?: Record<string, string>;
  balancing?: string;
  degraded?: string[];
  balanced?: boolean;
  note?: string;
};

type PromoPayload = {
  eligible?: boolean;
  endsAt?: string;
  teamNumber?: number | null;
  reason?: string | null;
  message?: string;
  pool?: PoolStatus;
  error?: string;
};

/**
 * Surfaces team 1111 sponsored-promo state (active window or expired reminder)
 * plus masked pool status (which providers are configured — never keys).
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
  const configured = payload.pool?.configured ?? [];
  const degraded = payload.pool?.degraded ?? [];

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
      {payload.eligible && configured.length > 0 ? (
        <div style={{ marginTop: "0.45rem", fontSize: "0.85rem", opacity: 0.92 }}>
          <div>
            Pool: {configured.join(", ")}
            {payload.pool?.balanced ? " · balanced (weighted round-robin)" : null}
          </div>
          {payload.pool?.note ? <div style={{ marginTop: "0.2rem" }}>{payload.pool.note}</div> : null}
          {degraded.length > 0 ? (
            <div style={{ marginTop: "0.2rem" }}>
              Temporarily degraded (skipped as primary): {degraded.join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {expired ? (
        <div style={{ marginTop: "0.45rem" }}>
          <Button as="a" variant="secondary" href={`/team/ai-keys?orgId=${encodeURIComponent(orgId)}`}>
            Add AI keys
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
