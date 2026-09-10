"use client";

import { Panel } from "../../components/ui";
import { inspectionFlagSeverityLabel } from "../../lib/inspection-copilot";
import type { InspectionCopilotView } from "../../lib/inspection-copilot/compute-inspection-copilot";
import {
  formatInspectionCopilotMetric,
  formatInspectionRiskPct,
} from "../../lib/inspection-copilot/inspection-copilot-related";
import type { InspectionFlagSeverity } from "../../lib/inspection-copilot/types";

const SEVERITY_TONE: Record<InspectionFlagSeverity, string> = {
  critical: "danger",
  warning: "demo",
  info: "good",
};

type LiveView = Extract<InspectionCopilotView, { status: "live" }>;

export function ChecksList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="inspection-copilot-checks" className="inspection-copilot-panel">
      <h2 style={{ marginTop: 0 }}>Inspection checks</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Flags and risk come only from limits and measurements you logged.
      </p>
      <ul className="inspection-copilot-list">
        {view.checks.map((check) => (
          <li key={check.id} className="app-card soft-panel inspection-copilot-card">
            <header className="inspection-copilot-card-head">
              <div>
                <span className={`app-badge ${check.flags.length === 0 ? "good" : "danger"}`}>
                  {check.flags.length === 0
                    ? "Clean"
                    : `${formatInspectionCopilotMetric(check.flags.length, true)} flag(s)`}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{check.robotName}</strong>
                <small className="app-muted">
                  {check.totalWeightLbs} lbs · risk{" "}
                  {formatInspectionRiskPct(check.riskScore, true, true)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${check.robotName}" check?`)) {
                    mutate({ action: "delete-check", checkId: check.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <p style={{ margin: 0 }}>{check.summary}</p>
            {check.flags.length > 0 ? (
              <ul className="factor-table inspection-copilot-flags">
                {check.flags.map((flag, index) => (
                  <li key={`${check.id}-${index}`}>
                    <span>
                      <span className={`app-badge ${SEVERITY_TONE[flag.severity]}`}>
                        {inspectionFlagSeverityLabel(flag.severity)}
                      </span>{" "}
                      {flag.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
