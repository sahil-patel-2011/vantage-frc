"use client";

import { Button, Panel } from "../../components/ui";
import {
  ANALYTICS_SOURCE_MODES,
  analyticsSourceDetail,
  analyticsSourceIssue,
  analyticsSourceLabel,
  type AnalyticsSourceMode,
  type AnalyticsSourceSettings,
} from "../../lib/analytics/lovat-data-source";

export function DataSourcePicker({
  settings,
  ownTeamKey,
  busy,
  onMode,
  onTeams,
  onEvents,
}: {
  settings: AnalyticsSourceSettings;
  ownTeamKey: string | null;
  busy?: boolean;
  onMode: (mode: AnalyticsSourceMode) => void;
  onTeams: (raw: string) => void;
  onEvents: (raw: string) => void;
}) {
  const issue = analyticsSourceIssue(settings, ownTeamKey);

  return (
    <Panel className="lovat-source-picker motion-card" style={{ minHeight: "auto" }}>
      <header>
        <h3>Data source</h3>
        <p className="app-muted">{analyticsSourceDetail(settings)}</p>
      </header>
      <div className="lovat-source-modes" role="radiogroup" aria-label="Data source">
        {ANALYTICS_SOURCE_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={settings.mode === mode ? "primary" : "secondary"}
            aria-pressed={settings.mode === mode}
            disabled={busy}
            onClick={() => onMode(mode)}
          >
            {analyticsSourceLabel(mode)}
          </Button>
        ))}
      </div>
      {settings.mode === "selected" ? (
        <label>
          Teams
          <input
            defaultValue={settings.teamKeys.join(", ")}
            placeholder="254, 1678"
            onBlur={(event) => onTeams(event.target.value)}
          />
        </label>
      ) : null}
      <label>
        Tournaments <span className="app-muted">(optional)</span>
        <input
          defaultValue={settings.eventKeys.join(", ")}
          placeholder="2026casj"
          onBlur={(event) => onEvents(event.target.value)}
        />
      </label>
      {issue.kind !== "ok" ? <p className="app-muted">{issue.message}</p> : null}
    </Panel>
  );
}
