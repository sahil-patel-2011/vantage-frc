"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { withOrgHref } from "../lib/nav/product-nav";
import type { Place, PlaceId } from "../lib/nav/places";
import { tourTargetForHref } from "../lib/tour/tour-steps";

/**
 * The phone's bottom bar: the five places, the same five as the desktop sidebar, in the same
 * order. It is complete: there is no More and no drawer behind it. A tool is reached through its
 * place or through search; pins are shortcuts on top (the sidebar, and empty search on a phone).
 */
export function AppShellIsland({
  orgId,
  places,
  currentPlace,
  unreadMessages,
}: {
  orgId: string;
  /** The places this person may open, in order. */
  places: Place[];
  currentPlace: PlaceId | null;
  /** Team chat's unread count, shown on Team (chat lives there). */
  unreadMessages: number;
}) {
  const pathname = usePathname() ?? "";
  /**
   * The tab just tapped, until the page it opens arrives. On venue Wi-Fi a tap used to change
   * nothing for seconds (same URL, same highlighted tab), so people tapped again or gave up.
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname, currentPlace]);
  useEffect(() => {
    if (!pendingHref) return;
    // A navigation that never lands (offline, an error page) must not leave the tab pulsing.
    const timer = window.setTimeout(() => setPendingHref(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  return (
    <nav className="soft-island" data-testid="soft-island" data-tour="island" aria-label="Places" data-count={places.length}>
      {places.map((place) => {
        const current = currentPlace === place.id;
        const pending = pendingHref === place.href && !current;
        const unread = place.id === "team" && unreadMessages >= 1 ? unreadMessages : 0;
        return (
          <a
            key={place.id}
            data-tour={tourTargetForHref(place.href)}
            aria-label={unread ? `${place.label}, ${unread} unread messages` : place.label}
            aria-current={current ? "page" : undefined}
            aria-busy={pending ? true : undefined}
            data-pending={pending ? "true" : undefined}
            href={withOrgHref(place.href, orgId)}
            onClick={(event) => {
              if (current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              setPendingHref(place.href);
            }}
          >
            <Icon name={place.icon} />
            <span>{place.shortLabel}</span>
            {unread ? <b className="soft-island-badge">{unread > 99 ? "99+" : unread}</b> : null}
          </a>
        );
      })}
    </nav>
  );
}
