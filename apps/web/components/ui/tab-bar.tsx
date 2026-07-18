import type { ReactNode } from "react";

export type SoftTab = {
  id: string;
  label: ReactNode;
  disabled?: boolean;
};

type TabBarProps = {
  tabs: SoftTab[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
  className?: string;
  /** Extra actions rendered after the tab buttons (e.g. Mark all read). */
  children?: ReactNode;
  /**
   * `pill` — segmented control (account / soft-tabs).
   * `toolbar` — loose filter buttons (notifications).
   */
  variant?: "pill" | "toolbar";
};

/** Shared Soft-UI section / filter tabs. */
export function TabBar({
  tabs,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
  children,
  variant = "pill",
}: TabBarProps) {
  const shell = variant === "toolbar" ? "soft-tab-toolbar" : "soft-tab-bar";
  return (
    <nav
      className={[shell, className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? (variant === "toolbar" ? "primary" : "active") : undefined}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
      {children}
    </nav>
  );
}
