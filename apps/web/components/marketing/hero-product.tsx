/**
 * Hero visual: Soft-UI Competition chrome.
 * Honest empty states — never invented match lists, EPA, or win rates.
 */

import { HeroProductVisual } from "./product-glances";

export function HeroProductPanel() {
  return (
    <figure className="mk-hero-figure">
      <HeroProductVisual />
      <figcaption>Competition after sign-in. Empty until this team’s TBA event is connected — not live data.</figcaption>
    </figure>
  );
}
