"use client";
import { useCallback, useEffect, useState } from "react";

type Snapshot = {
  board: { name: string; preset: string; widgets: Array<{ type: string }> };
  organization: { name: string; teamNumber: number };
  activeEvent: { name: string | null };
  nextMatch: null | {
    compLevel: string;
    matchNumber: number;
    scheduledTime: string;
    redAlliance: { teamKeys: string[] };
    blueAlliance: { teamKeys: string[] };
  };
  prediction: null | {
    matchKey: string;
    pRed: number;
    pBlue: number;
    confidenceLow: number;
    confidenceHigh: number;
    modelVersion: string;
    keyFactors: Array<{ name: string; impact: number; evidence: string }>;
    caveats: string[];
    scoredAt: string;
  };
  scouting: { assignments: number; reports: number; openDisagreements: number };
  updatedAt: string;
};

export default function KioskClient({
  params,
}: {
  params: { orgId?: string; boardId?: string; token?: string };
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    const query = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : `orgId=${params.orgId}&boardId=${params.boardId}`;
    try {
      const r = await fetch(`/api/display/snapshot?${query}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Display offline");
    }
  }, [params]);
  useEffect(() => {
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const live = setInterval(() => void refresh(), 30000);
    const status = () => setOnline(navigator.onLine);
    status();
    addEventListener("online", status);
    addEventListener("offline", status);
    return () => {
      clearInterval(clock);
      clearInterval(live);
      removeEventListener("online", status);
      removeEventListener("offline", status);
    };
  }, [refresh]);
  const match = data?.nextMatch;
  const remaining = match?.scheduledTime ? new Date(match.scheduledTime).getTime() - now : null;
  const countdown =
    remaining === null
      ? "—"
      : remaining <= 0
        ? "QUEUE NOW"
        : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  const leave = remaining !== null && remaining <= 15 * 60000;
  if (!data)
    return (
      <main className="kiosk loading">
        <h1>{error || "Loading display…"}</h1>
        <button onClick={refresh}>Retry</button>
      </main>
    );
  const prediction = data.prediction;
  return (
    <main className={`kiosk preset-${data.board.preset}`}>
      <header>
        <div>
          <span>VANTAGE DISPLAY</span>
          <strong>
            {data.organization.name} · #{data.organization.teamNumber}
          </strong>
        </div>
        <div className={online ? "online" : "offline"}>{online ? "CONNECTED" : "OFFLINE · LAST DATA"}</div>
        <button onClick={() => document.documentElement.requestFullscreen?.()}>Fullscreen</button>
        <button onClick={refresh}>Refresh</button>
      </header>
      <section className="kiosk-title">
        <div>
          <span>{data.activeEvent.name ?? "NO ACTIVE EVENT"}</span>
          <h1>{data.board.name}</h1>
        </div>
        <time>Updated {new Date(data.updatedAt).toLocaleTimeString()}</time>
      </section>
      {data.board.preset === "next_match" && (
        <section className="tv-next">
          <div>
            <span>NEXT MATCH</span>
            <strong>{match ? `${match.compLevel.toUpperCase()} ${match.matchNumber}` : "—"}</strong>
            <small>
              {match?.scheduledTime
                ? new Date(match.scheduledTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "Schedule unavailable"}
            </small>
          </div>
          <div className="countdown">
            <span>COUNTDOWN</span>
            <strong>{countdown}</strong>
            <em className={leave ? "leave" : ""}>{leave ? "LEAVE PIT NOW" : "STAY READY"}</em>
          </div>
          <div>
            <span>ALLIANCES</span>
            <p>
              <b>RED</b> {match?.redAlliance.teamKeys.join(" · ") ?? "—"}
            </p>
            <p>
              <b>BLUE</b> {match?.blueAlliance.teamKeys.join(" · ") ?? "—"}
            </p>
          </div>
        </section>
      )}
      {data.board.preset === "win_prediction" &&
        (prediction ? (
          <section className="tv-next">
            <div>
              <span>WIN PREDICTION · MODEL</span>
              <strong>{Math.round(prediction.pRed * 100)}% RED</strong>
              <small>
                {prediction.modelVersion} · {Math.round(prediction.confidenceLow * 100)}–
                {Math.round(prediction.confidenceHigh * 100)}% · {prediction.matchKey}
              </small>
            </div>
            <div className="countdown">
              <span>BLUE</span>
              <strong>{Math.round(prediction.pBlue * 100)}%</strong>
              <em>Not a TBA result</em>
            </div>
            <div>
              <span>TOP FACTORS</span>
              {(prediction.keyFactors ?? []).slice(0, 3).map((factor) => (
                <p key={factor.name}>
                  <b>{factor.impact}</b> {factor.name}
                </p>
              ))}
            </div>
          </section>
        ) : (
          <section className="tv-empty">
            <span>WIN PREDICTION</span>
            <h2>Awaiting a current prediction</h2>
            <p>
              Open Strategy once with a synced match + metrics so the model can persist a prediction for this event.
            </p>
          </section>
        ))}
      {data.board.preset === "robot_readiness" && (
        <section className="tv-empty">
          <span>ROBOT READINESS</span>
          <h2>Readiness data not yet synced</h2>
          <p>
            Battery, checklist, inspection, maintenance, and queue warnings stay blank rather than showing assumed
            status.
          </p>
        </section>
      )}
      {data.board.preset === "event_command" && (
        <section className="tv-command">
          <article>
            <span>NEXT TEAM MATCH</span>
            <strong>{match ? `${match.compLevel.toUpperCase()} ${match.matchNumber}` : "—"}</strong>
            <small>{countdown}</small>
          </article>
          <article>
            <span>EVENT ALERTS</span>
            <strong>{error ? "1" : "0"}</strong>
            <small>{error || "No current display alerts"}</small>
          </article>
        </section>
      )}
      {data.board.preset === "scouting_coverage" && (
        <section className="tv-command">
          <article>
            <span>ASSIGNMENTS</span>
            <strong>{data.scouting.assignments}</strong>
            <small>at active event</small>
          </article>
          <article>
            <span>REPORTS</span>
            <strong>{data.scouting.reports}</strong>
            <small>synced observations</small>
          </article>
          <article>
            <span>REVIEW WARNINGS</span>
            <strong>{data.scouting.openDisagreements}</strong>
            <small>open disagreements</small>
          </article>
        </section>
      )}
      {data.board.preset === "custom" && (
        <section className="tv-custom">
          {data.board.widgets.map((widget, index) => (
            <article key={`${widget.type}-${index}`}>
              <span>{widget.type.replaceAll("_", " ")}</span>
              <strong>
                {widget.type === "scouting_coverage"
                  ? `${data.scouting.reports} reports`
                  : widget.type === "win_prediction" && prediction
                    ? `${Math.round(prediction.pRed * 100)}% red`
                    : "Connected"}
              </strong>
            </article>
          ))}
        </section>
      )}
      <footer>
        <span>Layout is fixed until manually changed in Display Mode setup.</span>
        {error && <strong>{error}</strong>}
      </footer>
    </main>
  );
}
