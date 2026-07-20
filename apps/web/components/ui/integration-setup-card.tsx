import type { ReactNode } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import styles from "./ui.module.css";

type IntegrationSetupCardProps = {
  status: "not_configured" | "pending" | "connected";
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  ctaHref: string;
  ctaLabel: string;
  /** "What this unlocks" deep-link. */
  unlocksHref?: string;
  className?: string;
};

const statusBadge = {
  not_configured: { tone: "setup", label: "Not connected" },
  pending: { tone: "info", label: "Pending" },
  connected: { tone: "good", label: "Connected" },
} as const;

/**
 * One reusable connect-card for every setup_required integration (Onshape / TBA / Discord /
 * GitHub). Referenced from onboarding checklist deep-links so preview and destination match.
 */
export function IntegrationSetupCard({
  status,
  icon,
  title,
  description,
  ctaHref,
  ctaLabel,
  unlocksHref,
  className,
}: IntegrationSetupCardProps) {
  const badge = statusBadge[status];
  return (
    <section className={[styles.setupCard, className].filter(Boolean).join(" ")}>
      <div className={styles.setupHead}>
        <span className={styles.setupIcon}>{icon}</span>
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <h3 className={styles.setupTitle}>{title}</h3>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </div>
      <p className={styles.setupDesc}>{description}</p>
      <div className={styles.setupActions}>
        <Button as="a" href={ctaHref} variant={status === "connected" ? "secondary" : "primary"} size="sm">
          {ctaLabel}
        </Button>
        {unlocksHref ? (
          <a href={unlocksHref} className={styles.setupLink}>
            What this unlocks →
          </a>
        ) : null}
      </div>
    </section>
  );
}
