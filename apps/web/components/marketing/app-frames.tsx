import { MARKETING_HUBS } from "../../lib/marketing/product-story";
import { MIcon } from "./marketing-icons";

/** A public product map, not a screenshot or a simulated live dashboard. */
export function HeroProductPanel() {
  return (
    <figure className="mk-workspace-map">
      <figcaption><span>Vantage / your workspace</span><b>Product overview</b></figcaption>
      <div className="mk-map-home">
        <span className="mk-map-symbol" aria-hidden="true"><MIcon name="calendar" /></span>
        <div><p>Start with Home</p><h2>A place for today.</h2><span>Your boards, personal work and selected event.</span></div>
      </div>
      <div className="mk-map-grid">
        {[...MARKETING_HUBS].sort((a, b) => ["competition", "team", "build", "business"].indexOf(a.id) - ["competition", "team", "build", "business"].indexOf(b.id)).map((hub) => (
          <a href={hub.href} key={hub.id}>
            <MIcon name={hub.icon} /><strong>{hub.title}</strong>
            <span>{hub.modules.slice(0, 3).join(" · ")}</span>
            <i aria-hidden="true">↗</i>
          </a>
        ))}
      </div>
      <p className="mk-map-caption">Explore an area to see the tools inside.</p>
    </figure>
  );
}

export type ProductFrameId = "lookup" | "predict" | "picklist";

const previews: Record<ProductFrameId, { title: string; label: string; rows: [string, string][] }> = {
  lookup: { title: "Team profiles", label: "Know the robot", rows: [
    ["Overview", "Event results and scouting summaries"],
    ["Matches", "Review the observations behind a metric"],
    ["Capabilities & notes", "What your scouts recorded"],
  ] },
  predict: { title: "Match planning", label: "Prepare together", rows: [
    ["The matchup", "Review both alliances"],
    ["Roles & priorities", "Agree on your team's plan"],
    ["Evidence", "Check reports, sources and missing data"],
  ] },
  picklist: { title: "Pick lists", label: "Make the call", rows: [
    ["Your criteria", "Choose the metrics that matter"],
    ["Your order", "Compare teams and arrange tiers"],
    ["Selection board", "Track picks during alliance selection"],
  ] },
};

/** Labeled workflow illustrations; no invented scores, rankings or probabilities. */
export function ProductFrame({ id, headingLevel = 3 }: { id: ProductFrameId; headingLevel?: 2 | 3 }) {
  const preview = previews[id];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="mk-workflow-preview">
      <p>{preview.label}<span>Workflow overview</span></p>
      <Heading>{preview.title}</Heading>
      <dl>{preview.rows.map(([title, detail]) => (
        <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>
      ))}</dl>
    </div>
  );
}

export const MARKETING_APP_FRAMES: { id: ProductFrameId; title: string; copy: string }[] = [
  { id: "lookup", title: "Look beyond the average", copy: "Review a team's scouting alongside its public match record. Go back to individual reports when the numbers need context." },
  { id: "predict", title: "Turn observations into a plan", copy: "Compare the robots in a match and prepare your briefing. Estimates support your discussion; they do not guarantee a result." },
  { id: "picklist", title: "Choose what matters to your alliance", copy: "Use metrics, notes and your team's judgment to build the pick list and keep track of alliance selection." },
];
