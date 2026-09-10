import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import styles from "./ui.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg";

type ButtonOwnProps<T extends ElementType> = {
  as?: T;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
};

type ButtonProps<T extends ElementType> = ButtonOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps<T>>;

const variantClass: Record<ButtonVariant, string | undefined> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
  danger: styles.btnDanger,
  icon: styles.btnIcon,
};

const sizeClass: Record<ButtonSize, string | undefined> = {
  sm: styles.btnSm,
  md: styles.btnMd,
  lg: styles.btnLg,
};

/**
 * Shared Button — collapses the app's 15-way class fragmentation into typed variants.
 * Polymorphic like Panel (`as="a"` for links). variant="icon" meets 2.5.8 target size
 * (24px min, 44px on coarse pointers).
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
  const cls = [
    styles.btn,
    variant === "icon" ? undefined : sizeClass[size],
    variantClass[variant],
    variant === "primary" ? "is-primary" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const typeProp = Tag === "button" && (rest as { type?: string }).type == null ? { type: "button" } : {};
  return (
    <Tag className={cls} {...typeProp} {...rest}>
      {children}
    </Tag>
  );
}
