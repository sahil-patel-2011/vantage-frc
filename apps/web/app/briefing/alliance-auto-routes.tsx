"use client";

import { useEffect, useMemo, useState } from "react";
import { fieldPositionCellLabel } from "@vantage/scouting";
import { cellAt, secondsIntoAuto, type AutoRoute, type AutoRouteConflict } from "../../lib/strategy/auto-paths";

const COLORS = ["#2563eb", "#d97706", "#059669"];
const AUTO_MS = 6000;

/**
 * Our alliance's autonomous routes on one grid, played together: where each robot goes, and where
 * two would be in the same place at once. Shows nothing until a route is scouted: the form needs
 * an "Auto route" question, and the lead is told so once.
 */
export function AllianceAutoRoutes({
  orgId,
  eventKey,
  teamKeys,
}: {
  orgId: string | null | undefined;
  eventKey: string | null | undefined;
  teamKeys: string[];
}) {
  const [data, setData] = useState<{ routes: AutoRoute[]; conflicts: AutoRouteConflict[] } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(1);
  const teamsParam = teamKeys.join(",");

  useEffect(() => {
    if (!orgId || !eventKey || !teamsParam) return;
    let active = true;
    const params = new URLSearchParams({ orgId, eventKey, teams: teamsParam });
    void fetch(`/api/strategy/auto-routes?${params}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && body && Array.isArray(body.routes)) setData({ routes: body.routes, conflicts: body.conflicts ?? [] });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [orgId, eventKey, teamsParam]);

  // One pass through autonomous, then it rests on the end positions.
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / AUTO_MS);
      setAt(next);
      if (next < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const routes = useMemo(() => data?.routes ?? [], [data]);
  if (!data || routes.length === 0) return null;
  const grid = routes[0]!.grid;
  const cells = Array.from({ length: grid.gridCols * grid.gridRows }, (_, index) => index);
  const colorOf = (teamKey: string) => COLORS[routes.findIndex((route) => route.teamKey === teamKey) % COLORS.length]!;

  return (
    <section className="app-card brief-autos" aria-labelledby="brief-autos-title">
      <header className="brief-autos-head">
        <h2 id="brief-autos-title">Our autos together</h2>
        <button
          type="button"
          className="app-button secondary"
          onClick={() => {
            setAt(0);
            setPlaying(true);
          }}
          disabled={playing}
        >
          {playing ? "Playing…" : "Play autonomous"}
        </button>
      </header>
      <ul className="brief-autos-legend">
        {routes.map((route) => (
          <li key={route.teamKey}>
            <i style={{ background: colorOf(route.teamKey) }} aria-hidden="true" />
            <strong>{route.teamKey.replace(/^frc/, "")}</strong>{" "}
            <span className="app-muted">{route.route.map((cell) => fieldPositionCellLabel(cell, grid)).join(" → ")}</span>
          </li>
        ))}
      </ul>
      <div
        className="brief-autos-grid"
        role="img"
        aria-label={`Autonomous routes for ${routes.map((route) => route.teamKey.replace(/^frc/, "")).join(", ")}`}
        style={{ gridTemplateColumns: `repeat(${grid.gridCols}, 1fr)` }}
      >
        {cells.map((cell) => {
          const here = routes.filter((route) => cellAt(route.route, at) === cell);
          const trail = routes.filter((route) => route.route.includes(cell));
          return (
            <div key={cell} className={`brief-autos-cell${here.length > 1 ? " is-clash" : ""}`}>
              <small>{fieldPositionCellLabel(cell, grid)}</small>
              <span className="brief-autos-trail">
                {trail.map((route) => (
                  <i key={route.teamKey} style={{ background: colorOf(route.teamKey) }} />
                ))}
              </span>
              {here.map((route) => (
                <b key={route.teamKey} style={{ background: colorOf(route.teamKey) }}>
                  {route.teamKey.replace(/^frc/, "")}
                </b>
              ))}
            </div>
          );
        })}
      </div>
      {data.conflicts.length ? (
        <ul className="brief-autos-conflicts">
          {data.conflicts.map((conflict) => (
            <li key={`${conflict.teams.join("-")}-${conflict.cell}`}>
              {conflict.teams.map((team) => team.replace(/^frc/, "")).join(" and ")} could meet at {conflict.cellLabel},{" "}
              {secondsIntoAuto(conflict.at)}.
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">No two routes cross at the same moment.</p>
      )}
      <p className="app-muted brief-autos-note">
        From each robot&rsquo;s latest scouted route at this event. Timing is spread evenly across the 15 seconds, so treat a
        meeting as likely, not certain.
      </p>
    </section>
  );
}
