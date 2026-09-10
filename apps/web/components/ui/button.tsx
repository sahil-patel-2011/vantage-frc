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

function chromeFor(variant: ButtonVariant): string {
  switch (variant) {
    case "primary":
      return "app-button primary is-primary";
    case "secondary":
      return "app-button secondary";
    case "danger":
      return "app-button danger";
    case "ghost":
    case "icon":
      return "app-button ghost";
    default: {
      const _never: never = variant;
      return _never;
    }
  }
}

/**
 * Shared Button — one chrome for product pages.
 *
 * Variants map onto `.app-button` in system.css / styles.css so a primary
 * from this component and a leftover className="app-button" are the same
 * colour and height. variant="primary" also sets `.is-primary` for the R4
 * Playwright sweep.
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
    chromeFor(variant),
    size === "sm" ? "sm" : undefined,
    variant === "icon" ? styles.btnIcon : size === "lg" ? styles.btnLg : undefined,
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
