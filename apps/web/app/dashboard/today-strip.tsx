"use client";

import { Icon } from "../../components/shell/icon";
import type { TodayCard } from "../../lib/dashboard/today";
import { LiveCountdown } from "./widgets";
import "./today-strip.css";

/**
 * The glanceable row above the widget grid: what is next, what is mine, what
 * is unread. Cards only render with real data, so the row shrinks to nothing
 * on a quiet day instead of showing placeholders.
 */
export function TodayStrip({ cards }: { cards: TodayCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="dash-today" aria-label="Today">
      <ul>
        {cards.map((card) => (
          <li key={card.id} data-tone={card.tone}>
            <a href={card.href}>
              <i>
                <Icon name={card.icon} size={18} />
              </i>
              <span className="dash-today-copy">
                <small>{card.label}</small>
                <strong>{card.title}</strong>
                {card.detail || card.at ? (
                  <em>
                    {card.detail}
                    {card.at && card.id === "next_match" ? (
                      <>
                        {card.detail ? " · " : ""}
                        <LiveCountdown iso={card.at} />
                      </>
                    ) : null}
                  </em>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
