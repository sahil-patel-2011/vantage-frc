"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { aiSkillForPage, askAiHref } from "../lib/ai-skills/catalog";
import { withOrgHref } from "../lib/nav/product-nav";
import type { PinDefinition } from "../lib/nav/pins";
import { ShellSearchResults } from "./shell-search-results";
import { useExitPresence } from "./ui/use-exit-presence";
import { looksLikeQuestion, type ShellSearch } from "./use-shell-search";

const FOCUSABLE = 'a[href]:not([tabindex="-1"]),button:not(:disabled):not([tabindex="-1"]),input:not(:disabled)';

/**
 * The search palette: ⌘K / Ctrl+K anywhere, and the top bar's "Search or ask". One field in a
 * centered card, results grouped "Go to" and "In your team's data", recent places and
 * suggestions before you type, and an Ask AI row that hands the words to the assistant (there is
 * no other Ask AI button in the shell). Before you type, a phone also shows your pins: a phone
 * has no sidebar to keep them. Arrow keys move, Enter opens, Escape closes and puts focus back.
 */
export function AppShellSearchPalette({
  open,
  onClose,
  search,
  orgId,
  shortcutHint,
  pins = [],
  onEditPins,
}: {
  open: boolean;
  onClose: () => void;
  search: ShellSearch;
  orgId: string;
  shortcutHint: string;
  /** Pins this team may open (shown before typing, phones only). */
  pins?: PinDefinition[];
  onEditPins?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const presence = useExitPresence(open, 160);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLAnchorElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // ⌘K from the page itself has <body> as the "opener"; focusing that again on close left
    // keyboard users at the top of the document, so the search button takes its place.
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const opener = openerRef.current;
      openerRef.current = null;
      requestAnimationFrame(() => {
        // Something else took focus on purpose (a page the person opened): leave it there.
        if (document.activeElement && document.activeElement !== document.body && !cardRef.current?.contains(document.activeElement)) return;
        const visible = (node: HTMLElement | null | undefined) =>
          Boolean(node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
        const fallback = [...document.querySelectorAll<HTMLElement>(".app-topbar-search, .soft-menu-btn")].find(visible);
        (visible(opener) ? opener : fallback)?.focus();
      });
    };
  }, [open]);

  if (!presence.present) return null;

  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (node) => node.getClientRects().length > 0,
    );
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const listId = "search-palette-results";
  const hasRows = search.rows.length > 0;
  const question = search.query.trim();
  const pageSearch = typeof window === "undefined" ? "" : window.location.search;
  const tab = new URLSearchParams(pageSearch).get("tab");
  const from = tab ? `${pathname}?tab=${tab}` : pathname;
  const onAskAi = pathname === "/ai" || pathname.startsWith("/ai/");
  // Opened on this page's skill, as the old top-bar sparkles button was (lib/ai-skills).
  const pageSkill = onAskAi ? null : (aiSkillForPage(pathname, pageSearch)?.id ?? null);
  const askHref = askAiHref({ orgId: orgId || null, prompt: question || undefined, skill: pageSkill, from: pageSkill ? from : null });

  return (
    <div className="search-palette" data-closing={presence.closing || undefined} inert={presence.closing}>
      <button className="search-palette-scrim" type="button" tabIndex={-1} aria-label="Close search" onClick={onClose} />
      <div
        ref={cardRef}
        className="search-palette-card"
        role="dialog"
        aria-modal="true"
        aria-label="Search Vantage"
        onKeyDown={keepFocusInside}
      >
        <div className="search-palette-field">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search pages, tools, and your team's data, or ask AI"
            aria-expanded={hasRows}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={search.activeIndex >= 0 ? `search-palette-row-${search.activeIndex}` : undefined}
            value={search.query}
            placeholder="Search or ask…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              // A question goes to Ask AI on Enter; a name still opens the page or tool it matches.
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey && looksLikeQuestion(search.query)) {
                event.preventDefault();
                askRef.current?.click();
                return;
              }
              search.onFieldKeyDown(event);
            }}
          />
          {search.query ? (
            <button
              type="button"
              className="search-palette-clear"
              aria-label="Clear search"
              onClick={() => {
                search.setQuery("");
                inputRef.current?.focus();
              }}
            >
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        {/* Rows are reached with the arrow keys from the field, so the list itself is not a Tab stop. */}
        <div className="search-palette-results soft-nav-results" tabIndex={-1}>
          {!search.queryActive && pins.length > 0 ? (
            <section className="search-palette-pins" aria-labelledby="search-palette-pins-label">
              <header>
                <p className="command-group-head" id="search-palette-pins-label">Pinned</p>
                {onEditPins ? <button type="button" className="search-palette-pins-edit" onClick={onEditPins}>Edit</button> : null}
              </header>
              <nav aria-labelledby="search-palette-pins-label">
                {pins.map((pin) => (
                  <a key={pin.href} href={withOrgHref(pin.href, orgId || null)} onClick={onClose}>
                    <i><Icon name={pin.icon} /></i>
                    <span>{pin.label}</span>
                  </a>
                ))}
              </nav>
            </section>
          ) : null}
          <a ref={askRef} className="search-palette-ask" href={askHref} onClick={onClose} data-default={looksLikeQuestion(search.query) || undefined}>
            <i><Icon name="sparkles" /></i>
            <span>{question ? <>Ask AI: <strong>“{question}”</strong></> : "Ask AI a question"}</span>
            <small>Answers from your team&apos;s records</small>
          </a>
          <ShellSearchResults
            search={search}
            idPrefix="search-palette"
            orgId={orgId}
            shortcutHint={shortcutHint}
            rowsTabbable={false}
            fullSearchButton={false}
          />
          {search.searchError ? <p className="app-muted" role="status">{search.searchError}</p> : null}
        </div>
        <footer className="search-palette-foot">
          <p className="search-palette-keys" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>esc</kbd> close</span>
          </p>
          <button type="button" className="search-palette-full" onClick={search.openFullSearch}>
            {search.queryActive ? `Open full search for “${search.query.trim()}”` : "Open full search"}
          </button>
        </footer>
      </div>
    </div>
  );
}
