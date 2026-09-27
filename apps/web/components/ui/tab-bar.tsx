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
  const tabList = (
    <nav
      className={[shell, className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const enabled = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)')];
        const current = enabled.indexOf(event.target as HTMLButtonElement);
        if (current < 0 || enabled.length === 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus();
        enabled[next]?.click();
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? (variant === "toolbar" ? "primary" : "active") : undefined}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
  // Help and bulk actions are ordinary controls, not tabs in the tablist.
  return children ? <div className="soft-tab-container">{tabList}{children}</div> : tabList;
}
