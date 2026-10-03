"use client";

import { useEffect } from "react";
import { duplicateNextActions } from "../lib/nav/next-action-duplicates";

/** The row is labelled on most pages and only classed (`sched-next-actions`) on a few. */
const SECTION = 'section[aria-label="Next actions"], section[class*="next-actions"]';

function onScreen(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** Marks repeated next actions (and a row left with none) so system.css can hide them. */
function markDuplicates(main: HTMLElement) {
  const sections = [...main.querySelectorAll<HTMLElement>(SECTION)];
  if (!sections.length) return;
  const offered = [...main.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .filter((link) => !link.closest(SECTION) && onScreen(link))
    .map((link) => link.href);
  for (const section of sections) {
    const actions = [...section.querySelectorAll<HTMLAnchorElement>("a.edc-next-action[href]")];
    if (!actions.length) continue;
    const repeats = duplicateNextActions(actions.map((link) => link.href), offered, window.location.href);
    actions.forEach((link, index) => (link.closest("li") ?? link).toggleAttribute("data-repeat", repeats[index]));
    section.toggleAttribute("data-all-repeats", repeats.every(Boolean));
  }
}

/**
 * Mounted once in the app shell. Pages load their data after they render, so the row is
 * checked again whenever the page's content changes, not only on navigation.
 */
export function NextActionsDedupe({ routeKey }: { routeKey: string }) {
  useEffect(() => {
    let timer: number | undefined;
    const run = () => {
      window.clearTimeout(timer);
      // A timer, not an animation frame: frames stop while the tab is in the background.
      timer = window.setTimeout(() => {
        // Looked up each time: a navigation replaces the page's <main>.
        const main = document.querySelector<HTMLElement>("main");
        if (main) markDuplicates(main);
      }, 60);
    };
    run();
    // childList only: the attributes this sets must not wake it up again.
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [routeKey]);
  return null;
}
