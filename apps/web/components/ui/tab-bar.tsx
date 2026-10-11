"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
  /** Associate these tabs with a single panel whose content follows selection. */
  panelId?: string;
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
  panelId,
  children,
  variant = "pill",
}: TabBarProps) {
  const shell = variant === "toolbar" ? "soft-tab-toolbar" : "soft-tab-bar";
  const strip = useRef<HTMLElement>(null);
  // On a phone the strip scrolls sideways, and opening Competition on "Match plan" showed the
  // selected tab cut off at the edge ("Matc"). Bring it into view: the strip only, never the page.
  useEffect(() => {
    const nav = strip.current;
    const tab = nav?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const own = tab.getBoundingClientRect();
    if (own.left < box.left) nav.scrollLeft -= box.left - own.left + 16;
    else if (own.right > box.right) nav.scrollLeft += own.right - box.right + 16;
  }, [value]);
  const tabList = (
    <nav
      ref={strip}
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
            id={panelId ? `${panelId}-tab-${tab.id}` : undefined}
            aria-controls={panelId}
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
