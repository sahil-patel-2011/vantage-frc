"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "../../components/ui";
import {
  fieldBoundsForPaths,
  pathsFromScoutPayloads,
  playheadConflicts,
  playheadRange,
  playheadSample,
} from "../../lib/intel/path-playhead";

function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function IntelPathVisualizer({ payloads }: { payloads: Array<Record<string, unknown>> }) {
  const paths = useMemo(() => pathsFromScoutPayloads(payloads), [payloads]);
  const bounds = useMemo(() => fieldBoundsForPaths(paths), [paths]);
  const range = useMemo(() => playheadRange(paths), [paths]);
  const [t, setT] = useState(range?.min ?? 0);
  const [playing, setPlaying] = useState(false);
  const playhead = range ? Math.min(range.max, Math.max(range.min, t)) : 0;
  const samples = useMemo(() => playheadSample(paths, playhead), [paths, playhead]);
  const conflicts = useMemo(() => playheadConflicts(paths, playhead), [paths, playhead]);

  useEffect(() => {
    if (!playing || !range) return undefined;
    const step = (range.max - range.min) / 40;
    const id = window.setInterval(() => {
      setT((current) => {
        const next = current + step;
        return next > range.max ? range.min : next;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [playing, range]);

  return (
    <Panel className="intel-path" style={{ minHeight: "auto" }}>
      <h3 style={{ marginTop: 0 }}>Auto paths</h3>
      {paths.length === 0 || !range ? (
        <p className="intel-lookup-empty">
          Needs setup — no auto paths on file yet. Paths stay blank until scouting logs them.
        </p>
      ) : (
        <>
          <p className="app-muted">Play the recorded autos. Robots closer than two robot widths light up.</p>
          <svg
            className="intel-path-field"
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
            role="img"
            aria-label="Auto path field"
          >
            <rect x="0" y="0" width={bounds.width} height={bounds.height} className="intel-path-floor" />
            <line
              x1={bounds.width / 2}
              y1="0"
              x2={bounds.width / 2}
              y2={bounds.height}
              className="intel-path-half"
            />
            {paths.map((path, index) => (
              <polyline
                key={`path-${index}`}
                points={polyline(path)}
                fill="none"
                className="intel-path-line"
              />
            ))}
            {samples.map((sample, index) =>
              sample ? (
                <circle
                  key={`bot-${index}`}
                  cx={sample.x}
                  cy={sample.y}
                  r={Math.max(2, bounds.width / 54)}
                  className={
                    conflicts.some((hit) => hit.pair[0] === index || hit.pair[1] === index)
                      ? "intel-path-bot is-close"
                      : "intel-path-bot"
                  }
                />
              ) : null,
            )}
          </svg>
          <div className="intel-path-controls">
            <button
              type="button"
              className="intel-phase qol-press"
              aria-pressed={playing}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <label className="intel-path-playhead">
              <span className="sr-only">Playhead</span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={(range.max - range.min) / 40}
                value={playhead}
                onChange={(event) => {
                  setPlaying(false);
                  setT(Number(event.target.value));
                }}
                aria-label="Auto path playhead"
              />
            </label>
            <b>{playhead.toFixed(1)}</b>
          </div>
          {conflicts.length ? (
            <p className="intel-path-warn">{conflicts.length} close pair{conflicts.length === 1 ? "" : "s"} at this time.</p>
          ) : (
            <p className="app-muted">No close pairs at this time.</p>
          )}
        </>
      )}
    </Panel>
  );
}
