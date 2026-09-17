import type { ReactNode } from "react";
import { Icon, type IconName } from "../icon";

/**
 * The shared shapes every screen is built from.
 *
 * These existed already, on every page, assembled by hand — which is why no
 * two of them looked alike. One card had a 16px radius and the next had 22;
 * one row put its chevron in a button and the next used a glyph. Declaring
 * them once is the difference between a product and a set of pages.
 *
 * Styles live in app/vantage-kit.css.
 */

export type KitTone = "blue" | "green" | "teal" | "amber" | "red" | "violet" | "cyan";

/**
 * The tinted square at the head of a row.
 *
 * People learn the colour long before they read the label, so the tone is part
 * of the meaning. Keep a given tone attached to a given kind of thing.
 */
export function KitTile({
  icon,
  tone = "blue",
  size,
}: {
  icon: IconName;
  tone?: KitTone;
  size?: "lg";
}) {
  return (
    <span className="kit-tile" data-tone={tone} data-size={size} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

/** The small uppercase label that separates one group from the next. */
export function KitEyebrow({ children }: { children: ReactNode }) {
  return <span className="kit-eyebrow">{children}</span>;
}

export function KitCard({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
} & Record<string, unknown>) {
  return (
    <Tag className={`kit-card${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Tile, title, subtitle, chevron — as a link or a button.
 *
 * The whole row is the target. A chevron at the end of a 600-pixel row is a
 * needlessly small thing to ask a thumb to find, and on a phone in a pit that
 * is the difference between tapping it and tapping past it.
 */
export function KitRow({
  icon,
  tone = "blue",
  title,
  subtitle,
  href,
  onClick,
  chevron = true,
  disabled,
}: {
  icon?: IconName;
  tone?: KitTone;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  disabled?: boolean;
}) {
  const body = (
    <>
      {icon ? <KitTile icon={icon} tone={tone} /> : null}
      <span className="kit-row-body">
        <span className="kit-row-title">{title}</span>
        {subtitle ? <span className="kit-row-sub">{subtitle}</span> : null}
      </span>
      {chevron ? (
        <span className="kit-row-chevron" aria-hidden="true">
          <Icon name="chevron" />
        </span>
      ) : null}
    </>
  );

  if (href && !disabled) {
    return (
      <a className="kit-row" data-tone={tone} href={href}>
        {body}
      </a>
    );
  }
  return (
    <button className="kit-row" data-tone={tone} type="button" onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

export type KitStatItem = {
  /** The number. Already formatted — this does not decide how a value reads. */
  value: ReactNode;
  /** What the number means. Read once, then never again. */
  label: ReactNode;
  tone?: KitTone;
};

/**
 * A row of big numbers over small captions.
 *
 * Renders nothing at all when there is nothing to show. A stat strip of
 * dashes looks like a broken page, and an empty one at least reads as a
 * section that has not filled in yet.
 */
export function KitStats({ items }: { items: readonly KitStatItem[] }) {
  if (!items.length) return null;
  return (
    <div className="kit-stats">
      {items.map((item, index) => (
        <div className="kit-stat" key={index} data-tone={item.tone}>
          <b>{item.value}</b>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

/** Two or three exclusive choices in a recessed track. */
export function KitSegment<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; icon?: IconName }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="kit-segment" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
