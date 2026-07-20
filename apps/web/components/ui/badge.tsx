import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type BadgeTone = "good" | "setup" | "demo" | "danger" | "error" | "info" | "neutral";

type BadgeProps = {
  tone?: BadgeTone;
  /** Glyph paired with the tone. Omit to use the tone's default glyph; pass null to suppress. */
  icon?: ReactNode | null;
  /** ALWAYS a visible text label — never title/aria only (color is never the sole channel). */
  children: ReactNode;
  className?: string;
  title?: string;
};

// good / setup / demo are styled globally by soft-ui.css (.app-badge.<tone>).
// The rest ship here so the vocabulary is complete in any context.
const toneModule: Partial<Record<BadgeTone, string>> = {
  danger: styles.toneDanger,
  error: styles.toneError,
  info: styles.toneInfo,
  neutral: styles.toneNeutral,
};
const globalTone: Partial<Record<BadgeTone, string>> = {
  good: "good",
  setup: "setup",
  demo: "demo",
};

const CheckGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TriangleGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2 15 14H1L8 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8 6.5v3.2M8 11.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const InfoGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7.2v3.4M8 5.1v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const DotGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3.4" fill="currentColor" />
  </svg>
);

const defaultGlyph: Record<BadgeTone, ReactNode> = {
  good: <CheckGlyph />,
  setup: <TriangleGlyph />,
  demo: <InfoGlyph />,
  danger: <TriangleGlyph />,
  error: <TriangleGlyph />,
  info: <InfoGlyph />,
  neutral: <DotGlyph />,
};

/**
 * StatusBadge — colored status ALWAYS carries a visible text label + icon so meaning
 * survives grayscale / color-blindness. Maps to the shared `.app-badge` shape.
 */
export function Badge({ tone = "neutral", icon, children, className, title }: BadgeProps) {
  const glyph = icon === undefined ? defaultGlyph[tone] : icon;
  const cls = [
    "app-badge",
    globalTone[tone],
    toneModule[tone],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} title={title}>
      {glyph ? <span className={styles.badgeIcon}>{glyph}</span> : null}
      {children}
    </span>
  );
}
