"use client";

import { type ReactNode } from "react";
import type { BriefingChecklistRow } from "../../lib/briefing";
import type { OpponentCard } from "../../lib/briefing/opponent-cards";

/** Where each readiness row sends the coach to add it. */
export const CHECKLIST_HREFS: Record<string, string> = {
  Prediction: "/strategy",
  "Strategy plan": "/strategy",
  "Match card": "/match-strategy-cards",
  "Counter-book": "/counter-book",
  Watchlist: "/opponent-watchlist",
  "Defense plan": "/defense-planner",
  "Whiteboard play": "/whiteboard",
  "Practice data": "/practice",
  "Opponent video": "/video",
};

/** Plain names for the "Add more" line. */
const ADD_MORE_WORDS: Record<string, string> = {
  Prediction: "win chance",
  "Strategy plan": "game plan",
  "Match card": "match card",
  "Counter-book": "how to beat an opponent",
  Watchlist: "watchlist note",
  "Defense plan": "defense plan",
  "Whiteboard play": "whiteboard play",
  "Practice data": "practice runs",
  "Opponent video": "opponent video",
};

/** Rows without a win chance or game plan block nothing: they are extras. */
const BLOCKING = new Set(["Prediction", "Strategy plan"]);

export function withOrg(href: string, orgId: string | null): string {
  if (!orgId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}`;
}

/** Honest empty state for a section, written as one sentence with inline links. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="brief-missing">{children}</p>;
}

/** Collapsible section — one scrollable card the coach reads top-to-bottom. */
export function Section({ title, badge, children }: { title: string; badge?: string | null; children: ReactNode }) {
  return (
    <details className="app-card brief-section" open>
      <summary>
        <h2>{title}</h2>
        {badge ? <span className="brief-chip">{badge}</span> : null}
        <span className="brief-section-caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="brief-section-body">{children}</div>
    </details>
  );
}

/**
 * What else could go in this briefing, as one line at the bottom. It used to sit under the
 * hero as "2/9 READY" and seven red crosses, which pushed the opponents below the fold and
 * made a complete briefing look broken. Only a missing win chance or game plan is marked,
 * because only those leave the drive team short.
 */
export function AddMoreLine({ rows, orgId }: { rows: BriefingChecklistRow[]; orgId: string | null }) {
  const missing = rows.filter((row) => !row.ok);
  if (!missing.length) return null;
  const blocking = missing.filter((row) => BLOCKING.has(row.label));
  const extras = missing.filter((row) => !BLOCKING.has(row.label));
  const link = (row: BriefingChecklistRow) => (
    <a key={row.label} href={withOrg(CHECKLIST_HREFS[row.label] ?? "/workspace", orgId)}>
      {ADD_MORE_WORDS[row.label] ?? row.label.toLowerCase()}
    </a>
  );
  return (
    <section className="app-card brief-add-more" aria-label="Add more to this briefing">
      {blocking.length ? (
        <p className="brief-add-more-blocking">
          <b>Still missing:</b> {blocking.map((row, index) => [index ? ", " : "", link(row)])}
        </p>
      ) : null}
      {extras.length ? (
        <p>
          <b>Add more:</b> {extras.map((row, index) => [index ? " · " : "", link(row)])}
        </p>
      ) : null}
    </section>
  );
}

/** One card per opponent: number, plain lines, a likely-plan tag, and the team's own notes. */
export function OpponentCards({ cards, orgId }: { cards: OpponentCard[]; orgId: string | null }) {
  return (
    <ul className="brief-opp-cards">
      {cards.map((card) => (
        <li key={card.team} className="brief-opp-card">
          <div className="brief-opp-head">
            <b className="brief-opp-team">{card.team}</b>
            {card.nickname ? <span className="brief-opp-nick">{card.nickname}</span> : null}
            {card.standing ? <span className="brief-opp-standing">{card.standing}</span> : null}
          </div>
          {card.lines.length ? (
            <ul className="brief-opp-lines">
              {card.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="brief-opp-none">
              Not scouted yet. <a href={withOrg("/scouting", orgId)}>Scout this team</a>
            </p>
          )}
          {card.likelyPlan ? <span className="brief-opp-plan">{card.likelyPlan}</span> : null}
          {card.notes.length ? (
            <ul className="brief-opp-notes">
              {card.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
