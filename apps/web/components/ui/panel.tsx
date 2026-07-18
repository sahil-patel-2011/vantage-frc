import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type PanelOwnProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
};

type PanelProps<T extends ElementType> = PanelOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof PanelOwnProps<T>>;

/** Soft-UI surface: `app-card soft-panel` on section/article/form/etc. */
export function Panel<T extends ElementType = "section">({
  as,
  children,
  className,
  ...rest
}: PanelProps<T>) {
  const Tag = (as ?? "section") as ElementType;
  return (
    <Tag className={["app-card", "soft-panel", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
