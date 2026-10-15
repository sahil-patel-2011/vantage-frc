"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { withOrgHref, type IslandTabDefinition } from "../lib/nav/product-nav";
import { tourTargetForHref } from "../lib/tour/tour-steps";

export function AppShellIsland({
  orgId,
  islandTabs,
  activeIslandTabHref,
  unreadMessages,
  onOpenEditor,
  onOpenMore,
  navOpen,
  islandPressTimer,
  islandPressOrigin,
  islandLongPressed,
}: {
  orgId: string;
  islandTabs: IslandTabDefinition[];
  activeIslandTabHref: string | undefined;
  unreadMessages: number;
  onOpenEditor: () => void;
  /** Opens the menu of every page (the same panel as the top-left button). */
  onOpenMore: () => void;
  navOpen: boolean;
  islandPressTimer: { current: number | null };
  islandPressOrigin: { current: { x: number; y: number } | null };
  islandLongPressed: { current: boolean };
}) {
  const pathname = usePathname() ?? "";
  /**
   * The tab just tapped, until the page it opens arrives. On venue Wi-Fi a tap used to change
   * nothing for seconds (same URL, same highlighted tab), so people tapped again or gave up.
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname, activeIslandTabHref]);
  useEffect(() => {
    if (!pendingHref) return;
    // A navigation that never lands (offline, an error page) must not leave the tab pulsing.
    const timer = window.setTimeout(() => setPendingHref(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);
  // Team, Build, Business, Account… are not among the four apps by default. On those pages
  // nothing in the bar was current, so the bar said nothing about where you were; More is.
  const moreCurrent = !activeIslandTabHref;

  function clearIslandPress() {
    if (islandPressTimer.current !== null) {
      window.clearTimeout(islandPressTimer.current);
      islandPressTimer.current = null;
    }
    islandPressOrigin.current = null;
  }

  function startIslandPress(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearIslandPress();
    islandLongPressed.current = false;
    islandPressOrigin.current = { x: event.clientX, y: event.clientY };
    islandPressTimer.current = window.setTimeout(() => {
      islandPressTimer.current = null;
      islandPressOrigin.current = null;
      islandLongPressed.current = true;
      onOpenEditor();
    }, 450);
  }

  function trackIslandPress(event: PointerEvent<HTMLElement>) {
    const origin = islandPressOrigin.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearIslandPress();
  }

  return (
    <nav
      className="soft-island"
      aria-hidden={navOpen || undefined}
      inert={navOpen}
      data-testid="soft-island"
      data-tour="island"
      aria-label="Primary apps"
      title="Press and hold to change your apps"
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenEditor();
      }}
      onPointerDown={startIslandPress}
      onPointerMove={trackIslandPress}
      onPointerUp={clearIslandPress}
      onPointerCancel={clearIslandPress}
      onPointerLeave={clearIslandPress}
      onClickCapture={(event) => {
        if (!islandLongPressed.current) return;
        islandLongPressed.current = false;
        if (event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {islandTabs.map((tab) => {
        const current = activeIslandTabHref === tab.href;
        return (
          <a
            key={tab.href}
            data-tour={tourTargetForHref(tab.href)}
            aria-label={tab.href.includes("tab=messages") && unreadMessages >= 1 ? `${tab.label}, ${unreadMessages} unread` : tab.label}
            aria-current={current ? "page" : undefined}
            aria-busy={pendingHref === tab.href && !current ? true : undefined}
            data-pending={pendingHref === tab.href && !current ? "true" : undefined}
            href={withOrgHref(tab.href, orgId)}
            onClick={(event) => {
              if (current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              setPendingHref(tab.href);
            }}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.href.includes("tab=messages") && unreadMessages >= 1 ? (
              <b className="soft-island-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</b>
            ) : null}
          </a>
        );
      })}
      {/* No "Apps" gear: it took a fifth of the bar. Press and hold the bar (or right-click it),
          or use Edit in the menu, to change your apps; the bar shows the first four.

          More opens the same panel as the top-left menu button. That button is the hardest
          place on a phone to reach with a thumb, and without More the bar had no answer to
          "where am I" on any page outside the four apps. Styled as the tabs are (an <a>), it
          acts as a button: it opens the panel and goes nowhere. */}
      <a
        className="soft-island-more"
        href="#vantage-navigation-panel"
        role="button"
        aria-label="More: every page"
        aria-controls="vantage-navigation-panel"
        aria-expanded={navOpen}
        aria-current={moreCurrent ? "location" : undefined}
        onClick={(event) => {
          event.preventDefault();
          onOpenMore();
        }}
        onKeyDown={(event) => {
          if (event.key !== " ") return;
          event.preventDefault();
          onOpenMore();
        }}
      >
        <Icon name="sidebar" />
        <span>More</span>
      </a>
    </nav>
  );
}
