import type { ElementType, ReactNode } from "react";
import styles from "./ui.module.css";

type SectionHeadingProps = {
  title: ReactNode;
  /** Small uppercase eyebrow above the title. */
  kicker?: ReactNode;
  description?: ReactNode;
  /** Trailing actions (filters, buttons). */
  actions?: ReactNode;
  /** Heading level element for the title (default h2). */
  as?: ElementType;
  className?: string;
  id?: string;
};

/**
 * In-card / in-section heading: optional kicker + title + description, with trailing actions.
 * Unifies the ad-hoc `.soft-kicker` / `.eyebrow` + heading reimplementations.
 */
export function SectionHeading({
  title,
  kicker,
  description,
  actions,
  as,
  className,
  id,
}: SectionHeadingProps) {
  const Heading = (as ?? "h2") as ElementType;
  return (
    <div className={[styles.sectionHeading, className].filter(Boolean).join(" ")}>
      <div className={styles.sectionHeadingText}>
        {kicker != null ? <p className={styles.sectionKicker}>{kicker}</p> : null}
        <Heading className={styles.sectionTitle} id={id}>
          {title}
        </Heading>
        {description != null ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {actions != null ? <div className={styles.sectionActions}>{actions}</div> : null}
    </div>
  );
}
