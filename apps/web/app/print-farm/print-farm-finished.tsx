"use client";

import { Badge, Panel } from "../../components/ui";
import { failureReasonLabel } from "../../lib/print-farm";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, type LiveView } from "./print-farm-model";

export function RecentFinishedPanel({ view }: { view: LiveView }) {
  if (view.recentFinished.length === 0) return null;
  return (
    <Panel className="pf-panel">
      <h2>Recently finished</h2>
      <ul className="pf-list">
        {view.recentFinished.map((job) => (
          <li key={job.id} className="pf-row">
            <div className="pf-row-main">
              <div>
                <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
              </div>
              <strong className="pf-name">{job.partName}</strong>
              <small className="app-muted pf-block">
                {[
                  `×${job.quantity}`,
                  job.subsystemName ?? undefined,
                  job.finishedAt ? new Date(job.finishedAt).toLocaleString() : undefined,
                  job.actualMinutes != null ? `${job.actualMinutes} min` : undefined,
                  job.actualGrams != null ? `${job.actualGrams} g` : undefined,
                  job.failureReason ? failureReasonLabel(job.failureReason) : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
