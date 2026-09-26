import { GUIDED_TRACKS } from "../../../lib/guided/tracks";
import "./guided.css";

export const metadata = {
  title: "Checked step by step",
  description: "Step-by-step tracks where Vantage checks each step before it counts.",
};

export default function GuidedTracksPage() {
  return (
    <main className="module-page guided-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Code &amp; CAD / Checked step by step</span>
          <h1>Checked step by step</h1>
          <p>
            One step at a time. After each one, Vantage checks your work: it reads your Part Studio in Onshape, the output
            your build printed, or your pull request on GitHub. A step only counts once the check passes.
          </p>
        </div>
      </header>
      <ul className="guided-track-list">
        {GUIDED_TRACKS.map((track) => (
          <li key={track.id}>
            <a href={`/learn/guided/${track.id}`}>
              <strong>{track.title}</strong>
              <span>{track.summary}</span>
              <small>
                {track.steps.length} steps · {track.time} · {track.audience}
              </small>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
