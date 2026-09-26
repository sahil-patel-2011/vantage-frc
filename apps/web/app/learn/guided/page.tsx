import { GUIDED_TRACKS } from "../../../lib/guided/tracks";
import "./guided.css";

export const metadata = {
  title: "Checked step by step",
  description: "Step-by-step tracks where Vantage checks each step before it counts.",
};

/* Onshape tracks run in order, zero to robot CAD; the rest are the team's own weeks. */
const ONSHAPE = GUIDED_TRACKS.filter((track) => track.id.startsWith("onshape-"));
const GROUPS = [
  {
    id: "onshape",
    title: "Onshape CAD, from zero to robot parts",
    intro: "Do these in order. Each step reads your own Onshape document, so connect Onshape first (CAD → Connections).",
    numbered: true,
    tracks: ONSHAPE,
  },
  {
    id: "team",
    title: "Team tracks",
    intro: "Programming and shop weeks. Code steps read your build output or GitHub; shop steps are signed off by a lead.",
    numbered: false,
    tracks: GUIDED_TRACKS.filter((track) => !track.id.startsWith("onshape-")),
  },
];

export default function GuidedTracksPage() {
  return (
    <main className="module-page guided-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Code &amp; CAD / Checked step by step</span>
          <h1>Checked step by step</h1>
          <p>
            One step at a time. After each one, Vantage checks your work: it reads your own Onshape document, the output
            your build printed, or your pull request on GitHub. A step only counts once the check passes.
          </p>
        </div>
      </header>
      {GROUPS.map((group) =>
        group.tracks.length ? (
          <section key={group.id} className="guided-group" aria-labelledby={`guided-${group.id}`}>
            <h2 id={`guided-${group.id}`}>{group.title}</h2>
            <p>{group.intro}</p>
            <ol className="guided-track-list">
              {group.tracks.map((track, index) => (
                <li key={track.id}>
                  <a href={`/learn/guided/${track.id}`}>
                    <strong>
                      {group.numbered ? `${index + 1}. ` : ""}
                      {track.title}
                    </strong>
                    <span>{track.summary}</span>
                    <small>
                      {track.steps.length} steps · {track.time} · {track.audience}
                    </small>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ) : null,
      )}
    </main>
  );
}
