"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pages answer an action in place: "Saved.", "Could not delete…", in a role="status" or
 * role="alert" line, often at the top of a long form. On a phone, tapping Save at the bottom
 * then looked like nothing happened. When such a line changes just after a tap, submit or
 * Enter and is off screen, this repeats it as a short toast above the tab bar.
 *
 * The echo is visual only (aria-hidden, no pointer events): the original line is the live
 * region screen readers already hear. Background updates (sync badges, clocks) are ignored
 * because nothing echoes unless the person acted in the last few seconds.
 */
const REGION = '[role="status"], [role="alert"]';
const ARMED_MS = 8000;

type Echo = { id: number; text: string; error: boolean };

/** The edge of a fixed bar, or null when that bar is not showing (no bottom bar on a computer). */
function shownRect(selector: string): DOMRect | null {
  const bar = document.querySelector<HTMLElement>(selector);
  if (!bar) return null;
  const style = getComputedStyle(bar);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
  const rect = bar.getBoundingClientRect();
  return rect.width && rect.height ? rect : null;
}

function offScreen(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) return false; // hidden, not scrolled away
  // What the top bar and the bottom tab island actually cover. A fixed 96px at the bottom
  // counted a visible "Added …" line on a 1280px screen (no island there) as covered, and
  // echoed it as a toast over the form it was already showing in.
  const top = shownRect(".soft-topbar")?.bottom ?? 0;
  const bottom = shownRect(".soft-island")?.top ?? window.innerHeight;
  return rect.bottom < top || rect.top > bottom;
}

/** The region's own tone. Only an alert, or a line styled as an error, is an error toast. */
export function isErrorRegion(region: Element): boolean {
  if (region.getAttribute("role") === "alert") return true;
  // Class *words*, not substrings: a guided step's amber `guided-result is-fail` is a "not yet",
  // and turned red as a toast because its class contained "fail".
  const tokens = String((region as HTMLElement).className ?? "").split(/\s+/);
  return tokens.some((token) => /^(?:is-)?(?:error|bad|danger|critical)$/.test(token));
}

export function StatusEcho() {
  const [echo, setEcho] = useState<Echo | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let armedUntil = 0;
    let pending = new Set<Element>();
    let flush: number | null = null;
    let hide: number | null = null;
    let last = { text: "", at: 0 };
    const arm = () => {
      armedUntil = Date.now() + ARMED_MS;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") arm();
    };

    const check = () => {
      flush = null;
      const regions = pending;
      pending = new Set();
      for (const region of regions) {
        if (!region.isConnected || !region.closest("main") || region.closest('[role="dialog"], .status-echo')) continue;
        // A loading card is a status too (EmptyState with aria-busy); it is not an answer.
        if (region.closest('[aria-busy="true"]')) continue;
        const text = (region as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (!text || text.length > 220 || /(…|\.\.\.)$/.test(text)) continue;
        if (text === last.text && Date.now() - last.at < 3000) continue;
        if (!offScreen(region)) continue;
        last = { text, at: Date.now() };
        const error = isErrorRegion(region);
        const id = ++seq.current;
        setEcho({ id, text, error });
        if (hide) window.clearTimeout(hide);
        hide = window.setTimeout(() => setEcho((current) => (current?.id === id ? null : current)), error ? 6000 : 4000);
        return;
      }
    };

    const observer = new MutationObserver((records) => {
      if (Date.now() > armedUntil) return;
      for (const record of records) {
        const node = record.target;
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const region = element?.closest(REGION);
        if (region) pending.add(region);
        for (const added of record.addedNodes) {
          if (added.nodeType !== Node.ELEMENT_NODE) continue;
          const el = added as Element;
          if (el.matches(REGION)) pending.add(el);
          el.querySelectorAll(REGION).forEach((inner) => pending.add(inner));
        }
      }
      if (pending.size && flush == null) flush = window.setTimeout(check, 60);
    });

    document.addEventListener("pointerdown", arm, true);
    document.addEventListener("submit", arm, true);
    document.addEventListener("keydown", onKey, true);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      document.removeEventListener("pointerdown", arm, true);
      document.removeEventListener("submit", arm, true);
      document.removeEventListener("keydown", onKey, true);
      observer.disconnect();
      if (flush) window.clearTimeout(flush);
      if (hide) window.clearTimeout(hide);
    };
  }, []);

  if (!echo) return null;
  return (
    <div className="soft-toast-stack status-echo" aria-hidden="true">
      <div key={echo.id} className={echo.error ? "soft-toast bad" : "soft-toast"}>
        <strong style={{ fontSize: 13 }}>{echo.text}</strong>
      </div>
    </div>
  );
}
