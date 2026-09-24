"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss";
import { hubById, hubHref, hubLegacyHref, hubStripTabs } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";

/** The three places a scout goes during an event. Everything else is under More. */
const PRIMARY: Array<{ id: ScoutTab; label: string }> = [
  { id: "match", label: "Match" },
  { id: "pit", label: "Pit" },
  { id: "teams", label: "Robots" },
];

const SECONDARY: Array<{ id: ScoutTab; label: string; what: string }> = [
  { id: "handoff", label: "QR handoff", what: "Pass saved entries to another phone with no signal." },
  { id: "conflicts", label: "Conflicts", what: "Pick which scout was right when two disagree." },
  { id: "trust", label: "Trust & coverage", what: "How accurate each scout is, and which matches still need one." },
];

/**
 * Match / Pit / Robots, and one More.
 *
 * On a 390px phone the Competition hub stacked three rows of navigation over
 * the form: the hub's sections, the hub's scouting tools (Forms · Coverage ·
 * Shifts · More tools), then this screen's own chips (Match · Robots · Pit ·
 * More tools). Two of the rows each had a "More tools", and "Pit" meant the pit
 * checklist in one row and pit scouting in the next. The hub's tool row is
 * hidden on the scouting tab at phone width (see scouting.css) and its tools
 * are listed here instead, so a student sees the hub's sections and then one
 * control: the three views they switch between, and More for the rest.
 */
export function ScoutViewSwitcher({
  tab,
  onChange,
  orgId,
  embedded,
}: {
  tab: ScoutTab;
  onChange: (id: ScoutTab) => void;
  orgId: string;
  embedded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  // The same list the hub's tool row offers, so nothing it had is lost here.
  const hubTools = useMemo(() => {
    if (!embedded) return [];
    const hub = hubById("competition");
    return hubStripTabs(hub, "scouting")
      .filter((entry) => entry.group === "scouting")
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        href: entry.id === "forms" ? hubHref("/competition", "forms", orgId) : hubLegacyHref(entry, orgId),
      }));
  }, [embedded, orgId]);

  const activeSecondary = SECONDARY.find((entry) => entry.id === tab);

  return (
    <div className="scout-views" ref={ref}>
      <nav className="scout-views-row" aria-label="Scouting views">
        <div className="scout-segmented">
          {PRIMARY.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onChange(entry.id);
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={`scout-views-more${activeSecondary ? " is-active" : ""}`}
          aria-expanded={open}
          aria-controls={menuId}
          aria-current={activeSecondary ? "page" : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {activeSecondary ? activeSecondary.label : "More"}
          <span aria-hidden="true">▾</span>
        </button>
      </nav>
      {open ? (
        <div className="scout-views-menu" id={menuId}>
          <ul aria-label="More scouting views">
            {SECONDARY.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.id === tab ? "is-active" : undefined}
                  aria-current={entry.id === tab ? "page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onChange(entry.id);
                  }}
                >
                  <span>{entry.label}</span>
                  <small>{entry.what}</small>
                </button>
              </li>
            ))}
          </ul>
          {hubTools.length ? (
            // Phone width only: on a wide screen the hub's own tool row is
            // still on screen beside its tabs, and listing it twice is noise.
            <div className="scout-views-hub-tools">
              <p className="scout-views-menu-head">Scouting tools</p>
              <ul className="scout-views-tool-grid" aria-label="Scouting tools">
                {hubTools.map((entry) => (
                  <li key={entry.id}>
                    <a href={entry.href}>{entry.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
