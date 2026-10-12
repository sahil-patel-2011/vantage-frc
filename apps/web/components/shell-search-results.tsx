"use client";

import { useEffect } from "react";
import { Icon } from "./icon";
import { withOrgHref } from "../lib/nav/product-nav";
import type { CommandHit } from "../lib/nav/command-search";
import type { ShellSearch } from "./use-shell-search";

/**
 * The results list shared by the phone menu's search and the search palette: "Go to" (pages
 * and tools) then "In your team's data". With an empty field (palette only) the commands are
 * split into "Recent" and "Suggestions". Rows are options of a listbox driven by the field's
 * arrow keys (aria-activedescendant).
 */
export function ShellSearchResults({
  search,
  idPrefix,
  orgId,
  shortcutHint,
  /** Palette rows are reached with the arrow keys, so Tab moves on to the next control. */
  rowsTabbable = true,
  /** The phone menu offers full search under its results; the palette has it in its footer. */
  fullSearchButton = true,
}: {
  search: ShellSearch;
  idPrefix: string;
  orgId: string;
  shortcutHint: string;
  rowsTabbable?: boolean;
  fullSearchButton?: boolean;
}) {
  const { commandHits, searchHits, searchLoading, activeIndex, queryActive, query } = search;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${idPrefix}-row-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, idPrefix]);

  const commandRow = (hit: CommandHit, index: number) => (
    <a
      id={`${idPrefix}-row-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      className={index === activeIndex ? "is-active" : undefined}
      href={withOrgHref(hit.href, orgId)}
      key={hit.id}
      tabIndex={rowsTabbable ? undefined : -1}
      onMouseMove={() => {
        if (index !== activeIndex) search.setCursor(index);
      }}
      onClick={(event) => {
        event.preventDefault();
        search.goToCommand(hit);
      }}
    >
      <Icon name={hit.kind === "action" ? "bolt" : "chevron"} />
      <span>
        {hit.label}
        <small>{hit.context}</small>
      </span>
      {index === activeIndex ? <small aria-hidden="true">↵</small> : null}
    </a>
  );

  const recents = queryActive ? [] : commandHits.filter((hit) => hit.score > 0);
  const suggestions = queryActive ? [] : commandHits.filter((hit) => hit.score <= 0);
  const keys = shortcutHint.startsWith("⌘") ? "⌘" : "Ctrl";

  return (
    <>
      <div id={`${idPrefix}-results`} role={search.rows.length ? "listbox" : undefined} aria-label="Search results">
        {queryActive && commandHits.length > 0 ? (
          <div className="command-group" role="group" aria-label="Go to">
            <p className="command-group-head">Go to</p>
            {commandHits.map(commandRow)}
          </div>
        ) : null}
        {recents.length > 0 ? (
          <div className="command-group" role="group" aria-label="Recent">
            <p className="command-group-head">Recent</p>
            {recents.map(commandRow)}
          </div>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="command-group" role="group" aria-label="Suggestions">
            <p className="command-group-head">Suggestions</p>
            {suggestions.map((hit, offset) => commandRow(hit, recents.length + offset))}
          </div>
        ) : null}

        {searchHits.length > 0 ? (
          <section className="command-search-hits" role="group" aria-label="Your data">
            <header>
              <strong>In your team&apos;s data</strong>
              {searchLoading ? <small>Searching…</small> : null}
            </header>
            <nav role="presentation">
              {searchHits.map((hit, offset) => {
                const index = commandHits.length + offset;
                return (
                  <a
                    id={`${idPrefix}-row-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? "is-active" : undefined}
                    href={hit.href}
                    key={`${hit.href}-${hit.title}`}
                    tabIndex={rowsTabbable ? undefined : -1}
                    onMouseMove={() => {
                      if (index !== activeIndex) search.setCursor(index);
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      search.openRow(index);
                    }}
                  >
                    <Icon name="search" />
                    <span>
                      {hit.title}
                      {hit.subtitle ? <small>{hit.subtitle}</small> : null}
                    </span>
                    {hit.sourceLabel ? <small>{hit.sourceLabel}</small> : null}
                  </a>
                );
              })}
            </nav>
          </section>
        ) : null}
      </div>
      {queryActive ? (
        <>
          {searchLoading ? <p role="status">Searching your team’s data…</p> : null}
          {fullSearchButton ? (
            <button type="button" className="command-open-full" onClick={search.openFullSearch}>
              Open full search for “{query.trim()}”
            </button>
          ) : null}
          {search.rows.length === 0 && !searchLoading ? (
            <p className="command-empty">
              {/* A phone has no Ctrl or ⌘: the keys are said only where there is a keyboard,
                  and only the one this device has. */}
              No page or tool matches “{query.trim()}”. Open full search to look through your team’s data
              <span className="command-empty-keys"> ({keys}+Enter)</span>.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
