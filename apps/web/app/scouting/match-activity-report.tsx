import { CAPTURE_KINDS, captureSummary, matchCapture, type CaptureKind } from "@vantage/scouting";
import { clockLabel } from "../../lib/scouting/match-clock";
import styles from "./match-activity.module.css";

export const ACTIVITY_LABELS: Record<CaptureKind, string> = { shooting: "Shooting", feeding: "Feeding", defending: "Defense", disabled: "Disabled" };

export function MatchActivityReport({ payload }: { payload: Record<string, unknown> }) {
  const capture = matchCapture(payload);
  if (!capture?.bouts.length) return null;
  const summary = captureSummary(capture);
  return <section className={styles.report} aria-label="Observed match activity">
    <h3>Observed match activity</h3>
    <div className={styles.metrics}>{CAPTURE_KINDS.map(kind => {
      const metric = summary[kind];
      return <div key={kind}><span>{ACTIVITY_LABELS[kind]}</span><strong>{metric.bouts ? `${metric.seconds.toFixed(1)}s` : "Not recorded"}</strong>
        {kind === "shooting" || kind === "feeding" ? <small>{metric.perSecond === null ? "Throughput not observed" : `${metric.perSecond.toFixed(2)} fuel/s · ${metric.count} in ${metric.countedSeconds.toFixed(1)}s`}</small> : null}
        {metric.unknownBouts && (kind === "shooting" || kind === "feeding") ? <small>{metric.unknownBouts} uncounted bout{metric.unknownBouts === 1 ? "" : "s"} excluded from rate</small> : null}
      </div>;
    })}</div>
    <p className="app-muted">Observed intervals only. Fuel released is not official fuel scored; rates do not estimate a full match.</p>
    <details><summary data-disclosure>Activity timeline · {capture.bouts.filter(bout => !bout.voided).length} bouts</summary>
      <ol className={styles.timeline}>{capture.bouts.map(bout => <li key={bout.id} data-voided={bout.voided || undefined}>
        <time>{clockLabel(bout.startMs)}–{bout.endMs === null ? "running" : clockLabel(bout.endMs)}</time>
        <span>{ACTIVITY_LABELS[bout.kind]}{bout.voided ? " · removed" : bout.count === null ? "" : ` · ${bout.count} fuel`}</span>
      </li>)}</ol>
    </details>
  </section>;
}
