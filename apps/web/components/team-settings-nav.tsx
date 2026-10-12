"use client";

import { useEffect, useRef } from "react";
import { withOrgHref } from "../lib/nav/product-nav";
import { TEAM_SETTINGS_PAGES, type TeamSettingsPageId } from "../lib/nav/team-settings-nav";
import { useInSettingsLayout } from "./settings-layout";
import "./team-settings-nav.css";

/** One chip row, the same on every team settings page, with the page you are on marked. */
export function TeamSettingsNav({ orgId, current }: { orgId: string | null | undefined; current: TeamSettingsPageId }) {
  // On a phone the row scrolls sideways; start it with this page's chip in view (AI keys showed
  // as "AI key" cut off at the right edge).
  const navRef = useRef<HTMLElement | null>(null);
  // Inside Settings the list beside the page is the navigation; a chip row repeated it.
  const inSettings = useInSettingsLayout();
  useEffect(() => {
    const nav = navRef.current;
    const here = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !here || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, here.offsetLeft - (nav.clientWidth - here.clientWidth) / 2);
  }, [current]);
  if (inSettings) return null;
  return (
    <nav ref={navRef} className="team-settings-nav" aria-label="Team settings">
      {TEAM_SETTINGS_PAGES.map((page) => (
        <a
          key={page.id}
          href={withOrgHref(page.href, orgId ?? null)}
          aria-current={page.id === current ? "page" : undefined}
          className={page.id === current ? "is-current" : undefined}
        >
          {page.label}
        </a>
      ))}
    </nav>
  );
}
