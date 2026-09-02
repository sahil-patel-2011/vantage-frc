import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import styles from "./ui.module.css";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon";
type ButtonSize = "sm" | "md";

type ButtonOwnProps<T extends ElementType> = {
  as?: T;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
};

type ButtonProps<T extends ElementType> = ButtonOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps<T>>;

/** Variants with no global `.app-button` equivalent keep the module styles. */
const moduleVariantClass: Record<Exclude<ButtonVariant, "primary" | "secondary">, string | undefined> = {
  danger: styles.btnDanger,
  ghost: styles.btnGhost,
  icon: styles.btnIcon,
};

/**
 * Shared Button. `primary` / `secondary` render the global `.app-button` /
 * `.app-button.secondary` classes, so a <Button> is pixel-identical to the
 * hand-written `<button className="app-button">` beside it and inherits the
 * shell's 44px targets — new code can reach for this without a mass replace.
 * `danger`, `ghost` and `icon` have no global counterpart and keep the module
 * styles; variant="icon" meets 2.5.8 target size (24px min, 44px on coarse pointers).
 * Polymorphic like Panel (`as="a"` for links).
 */
export function Button<T extends ElementType = "button">({
  as,
  variant = "secondary",
  size = "md",
  children,
  className,
  ...rest
}: ButtonProps<T>) {
  const Tag = (as ?? "button") as ElementType;
  const cls = (
    variant === "primary" || variant === "secondary"
      ? ["app-button", variant === "secondary" ? "secondary" : undefined, size === "sm" ? styles.btnSm : undefined, className]
      : [styles.btn, variant === "icon" ? undefined : size === "sm" ? styles.btnSm : styles.btnMd, moduleVariantClass[variant], className]
  )
    .filter(Boolean)
    .join(" ");
  const typeProp = Tag === "button" && (rest as { type?: string }).type == null ? { type: "button" } : {};
  return (
    <Tag className={cls} {...typeProp} {...rest}>
      {children}
    </Tag>
  );
}
