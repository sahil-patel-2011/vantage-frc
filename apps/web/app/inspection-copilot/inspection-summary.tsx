"use client";

import { Panel } from "../../components/ui";
import {
  formatInspectionCopilotMetric,
  formatInspectionRiskPct,
} from "../../lib/inspection-copilot/inspection-copilot-related";

export function SummaryTiles({
  checkCount,
  flaggedCount,
  criticalCount,
  latestRisk,
  loaded,
}: {
  checkCount: number;
  flaggedCount: number;
  criticalCount: number;
  latestRisk: number | null;
  loaded: boolean;
}) {
  const hasChecks = checkCount > 0;
  const tiles = [
    { label: "Checks", value: formatInspectionCopilotMetric(checkCount, loaded) },
    { label: "Flagged", value: formatInspectionCopilotMetric(flaggedCount, loaded) },
    { label: "Critical flags", value: formatInspectionCopilotMetric(criticalCount, loaded) },
    {
      label: "Latest risk",
      value: formatInspectionRiskPct(latestRisk, loaded, hasChecks),
    },
  ];
  return (
    <Panel className="inspection-copilot-coverage" aria-label="Inspection Copilot summary">
      <div className="inspection-copilot-stats">
        <div>
          <span
            className={`app-badge ${
              checkCount === 0 ? "setup" : criticalCount > 0 ? "danger" : flaggedCount > 0 ? "demo" : "good"
            }`}
          >
            {checkCount === 0 ? "EMPTY" : criticalCount > 0 ? "CRITICAL" : flaggedCount > 0 ? "FLAGS" : "CLEAN"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season readiness</h2>
          <small className="app-muted">Logged measurements only.</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}
