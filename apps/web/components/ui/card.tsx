import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import styles from "./ui.module.css";

type CardOwnProps<T extends ElementType> = {
  as?: T;
  /** Optional card title — renders a header row. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Trailing header actions (buttons, menus). */
  actions?: ReactNode;
  /** Footer region below a divider. */
  footer?: ReactNode;
  pad?: "none" | "sm" | "md" | "lg";
  children?: ReactNode;
  className?: string;
};

type CardProps<T extends ElementType> = CardOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof CardOwnProps<T>>;

const padClass = {
  none: styles.cardPadNone,
  sm: styles.cardPadSm,
  md: undefined, // .app-card default padding
  lg: styles.cardPadLg,
} as const;

/**
 * Structural surface — the raised `.app-card soft-panel`, with optional title/actions/footer.
 * Use for structural / comparison containers (pick columns, kanban, forms). For flat KPI
 * numbers use StatTile instead.
 */
export function Card<T extends ElementType = "section">({
  as,
  title,
  subtitle,
  actions,
  footer,
  pad = "md",
  children,
  className,
  ...rest
}: CardProps<T>) {
  const Tag = (as ?? "section") as ElementType;
  const cls = ["app-card", "soft-panel", padClass[pad], className].filter(Boolean).join(" ");
  const hasHeader = title != null || actions != null;
  return (
    <Tag className={cls} {...rest}>
      {hasHeader ? (
        <div className={styles.cardHeader}>
          <div className={styles.cardHeadings}>
            {title != null ? <h3 className={styles.cardTitle}>{title}</h3> : null}
            {subtitle != null ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          </div>
          {actions != null ? <div className={styles.cardActions}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer != null ? <div className={styles.cardFooter}>{footer}</div> : null}
    </Tag>
  );
}
