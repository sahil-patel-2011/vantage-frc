import { GUIDED_TRACKS } from "../../../lib/guided/tracks";
import "./guided.css";

export const metadata = {
  title: "Guided tracks",
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
    id: "code",
    title: "Code and GitHub",
    intro: "For any team's programmers. Steps read what your terminal printed or ask GitHub about your pull request.",
    numbered: false,
    tracks: GUIDED_TRACKS.filter((track) => track.id.startsWith("git-")),
  },
  {
    id: "team",
    title: "Team tracks",
    intro: "Programming and shop weeks. Code steps read your build output or GitHub; shop steps are signed off by an owner or admin on Team progress.",
    numbered: false,
    tracks: GUIDED_TRACKS.filter((track) => !track.id.startsWith("onshape-") && !track.id.startsWith("git-")),
  },
];

export default function GuidedTracksPage() {
  return (
    <main className="module-page guided-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Learn / Guided tracks</span>
          <h1>Guided tracks</h1>
          <p>
            One step at a time. After each one, Vantage checks your work: it reads your own Onshape document, the output
            your build printed, or your pull request on GitHub. A step only counts once the check passes. Each Onshape
            track ends with a practice part you build on your own, measured against its drawing.
          </p>
          <p className="guided-meta">
            Owners and admins: <a href="/learn/guided/team">Team progress</a> shows every member&apos;s steps and the
            sign-offs waiting for you.
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
