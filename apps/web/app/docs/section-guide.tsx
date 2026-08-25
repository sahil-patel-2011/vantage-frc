"use client";

import { useMemo, useState } from "react";
import { TabBar } from "../../components/ui";
import { PRODUCT_HUBS } from "../../lib/nav/hubs";
import {
  SEASON_MOMENTS,
  SECTION_HELP,
  type SeasonMoment,
  type SectionHelpEntry,
} from "../../lib/help/section-help";
import "./section-guide.css";

type MomentFilter = SeasonMoment | "all";

function matchesQuery(entry: SectionHelpEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return true;
  return [entry.title, entry.what, entry.why, entry.when, ...entry.how, ...(entry.tips ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * "How Vantage works, section by section" — the whole section-help registry,
 * grouped by hub and filterable by season moment, so a lead can think through
 * before season / kickoff / build / pre-comp / comp day / after in one place.
 */
export default function SectionGuide() {
  const [moment, setMoment] = useState<MomentFilter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      SECTION_HELP.filter(
        (entry) =>
          (moment === "all" || entry.moments.includes(moment)) && matchesQuery(entry, query),
      ),
    [moment, query],
  );

  const groups = useMemo(
    () =>
      PRODUCT_HUBS.map((hub) => ({
        hub,
        entries: visible.filter((entry) => entry.hub === hub.id),
      })).filter((group) => group.entries.length > 0),
    [visible],
  );

  const activeMoment = SEASON_MOMENTS.find((entry) => entry.id === moment);

  return (
    <section className="section-guide" aria-label="How Vantage works, section by section">
      <header className="section-guide-head">
        <h2>How Vantage works, section by section</h2>
        <p className="app-muted">
          Every workbench and major tool, with what it is, why it matters, when in the season it
          belongs, and the steps to run it. Filter by season moment to plan before the season, during
          build, at an event, and after.
        </p>
      </header>

      <TabBar
        aria-label="Season moment"
        variant="toolbar"
        value={moment}
        onChange={(next) => setMoment(next as MomentFilter)}
        className="section-guide-moments"
        tabs={[
          { id: "all", label: "All season" },
          ...SEASON_MOMENTS.map((entry) => ({ id: entry.id, label: entry.label })),
        ]}
      />

      <p className="section-guide-count app-muted" role="status">
        {activeMoment ? `${activeMoment.blurb} · ` : ""}
        {visible.length} of {SECTION_HELP.length} sections
      </p>

      <label className="section-guide-search" htmlFor="section-guide-search-input">
        <span className="eyebrow">Filter sections</span>
        <input
          id="section-guide-search-input"
          type="search"
          value={query}
          placeholder="e.g. scouting, alliance, budget, kiosk…"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {groups.length === 0 ? (
        <p className="app-muted section-guide-empty" role="status">
          No section matches that filter. Clear the text filter, or switch back to All season.
        </p>
      ) : null}

      {groups.map(({ hub, entries }) => (
        <section key={hub.id} className="section-guide-hub" aria-labelledby={`guide-hub-${hub.id}`}>
          <header>
            <h3 id={`guide-hub-${hub.id}`}>{hub.label}</h3>
            <a className="section-guide-hub-link" href={hub.href}>
              Open {hub.label}
            </a>
          </header>

          <ul className="section-guide-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <details className="section-guide-card">
                  <summary>
                    <strong>{entry.title}</strong>
                    <span>{entry.what}</span>
                  </summary>

                  <div className="section-guide-detail">
                    <p className="section-guide-fact">
                      <span>Why</span>
                      {entry.why}
                    </p>
                    <p className="section-guide-fact">
                      <span>When</span>
                      {entry.when}
                    </p>

                    <div className="section-guide-moment-chips">
                      {entry.moments.map((id) => (
                        <em key={id}>
                          {SEASON_MOMENTS.find((season) => season.id === id)?.label ?? id}
                        </em>
                      ))}
                    </div>

                    <h4>How</h4>
                    <ol>
                      {entry.how.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>

                    {entry.tips?.length ? (
                      <>
                        <h4>Tips</h4>
                        <ul>
                          {entry.tips.map((tip) => (
                            <li key={tip}>{tip}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}

                    <div className="section-guide-links">
                      {entry.related.map((link) => (
                        <a key={link.href} href={link.href}>
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
