"use client";

import { useCallback, type ReactNode } from "react";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { Panel, ToolStrip } from "../../components/ui";
import { PageOptions } from "../../components/ui/page-options";
import {
  formatMediaMetric,
  mediaReadinessPct,
  shouldShowMediaSummaryTiles,
} from "../../lib/media";
import {
  CalendarPanel,
  DraftsPanel,
  ImpactPanel,
  KitPanel,
  RemindersPanel,
} from "./media-panels";
import { type LiveView, type Tab } from "./media-helpers";
import { MediaRelatedStrip } from "./media-related-strip";
import "../product-hub.css";


export function LiveMediaWorkspace({
  view,
  tab,
  onTab,
  tabs,
  busy,
  error,
  cutoffCode,
  draftMeta,
  mutate,
  banner,
}: {
  view: LiveView;
  tab: Tab;
  onTab: (tab: Tab) => void;
  tabs: Array<{ id: Tab; label: string }>;
  busy: boolean;
  error: string;
  cutoffCode: string | null;
  draftMeta: { feature: string; generatedAt: string } | null;
  mutate: (payload: Record<string, unknown>, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
  banner?: ReactNode;
}) {
  const orgId = view.orgId;
  const showTiles = shouldShowMediaSummaryTiles({
    kit: view.kit,
    outreach: view.outreach,
    impact: view.impact,
    sponsorWall: view.sponsorWall,
    items: view.items,
  });

  const create = useCallback(
    (payload: Record<string, unknown>) => mutate(payload, "POST"),
    [mutate],
  );

  const markPosted = useCallback(
    async (itemId: string) => {
      await mutate({ action: "mark-posted", tab, itemId }, "POST");
    },
    [mutate, tab],
  );

  const aiDraft = useCallback(
    async (payload: Record<string, unknown>) => {
      await mutate(payload, "POST");
    },
    [mutate],
  );

  const dismiss = useCallback(
    async (itemId: string) => {
      await mutate({ action: "dismiss-reminder", tab: "reminders", itemId }, "POST");
    },
    [mutate],
  );

  return (
    <main className="module-page media-page">
      <div className="workspace-hub-header">
        <div className="hub-bar-id"><h1>Media</h1></div>
        <ToolStrip aria-label="Media section" items={tabs.map(entry => ({ id: entry.id, label: entry.label }))}
          value={tab} onChange={id => { if (tabs.some(entry => entry.id === id)) onTab(id as Tab); }} />
        <PageOptions><MediaRelatedStrip orgId={orgId} /></PageOptions>
      </div>
      {banner}


      {error ? <p className="app-error">{error}</p> : null}
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {showTiles ? (
        <Panel>
          <div className="media-stats" aria-label="Media summary">
            <div>
              <strong>{formatMediaMetric(view.items.length, true)}</strong>
              <span className="app-muted"> Content items</span>
            </div>
            <div>
              <strong>{mediaReadinessPct(view.kit.readinessScore)}</strong>
              <span className="app-muted"> Kit readiness</span>
            </div>
            <div>
              <strong>{formatMediaMetric(view.impact.mediaActivityCount, true)}</strong>
              <span className="app-muted"> Media impact logs</span>
            </div>
          </div>
        </Panel>
      ) : null}

      {tab === "calendar" ? (
        <CalendarPanel view={view} busy={busy} onCreate={create} onMarkPosted={markPosted} />
      ) : null}
      {tab === "drafts" ? (
        <DraftsPanel
          view={view}
          busy={busy}
          cutoffCode={cutoffCode}
          draftMeta={draftMeta}
          onCreate={create}
          onAiDraft={aiDraft}
          onMarkPosted={markPosted}
        />
      ) : null}
      {tab === "reminders" ? (
        <RemindersPanel view={view} busy={busy} onDismiss={dismiss} />
      ) : null}
      {tab === "kit" ? <KitPanel view={view} /> : null}
      {tab === "impact" ? <ImpactPanel view={view} /> : null}
    </main>
  );
}
