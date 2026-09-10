"use client";

import { useCallback } from "react";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { PageHeader, Panel, TabBar, ToolStrip } from "../../components/ui";
import {
  formatMediaMetric,
  mediaReadinessPct,
  shouldShowMediaSummaryTiles,
} from "../../lib/media";
import { hubById, hubLegacyHref, hubNestedTabs } from "../../lib/nav/hubs";
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

const MEDIA_HUB = hubById("media");
/** Tools nested under Kit — the Kit root itself stays in the tab bar above. */
const kitTools = hubNestedTabs(MEDIA_HUB, "kit").filter((entry) => entry.group === "kit");

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
      <PageHeader
        breadcrumbs="Media"
        title="Media"
        description={`${view.orgName}${view.teamNumber != null ? ` · Team ${view.teamNumber}` : ""} · ${view.seasonYear} content calendar, drafts, kit, and impact — recorded rows only.`}
      >
        <div className="media-header-actions">
          <MediaRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      <TabBar
        aria-label="Media sections"
        value={tab}
        onChange={(id) => onTab(id as Tab)}
        tabs={tabs}
        className="product-hub-tabs"
      />
      {/* Tools *inside* the open workbench only. "Kit" is already the selected
          tab one row up, so listing its root here rendered the same workbench
          twice — the strip is how you reach what is nested under it. */}
      {kitTools.length > 0 && tab === "kit" ? (
        <ToolStrip
          aria-label="Tools in Kit"
          value="kit"
          onChange={(id) => {
            if (id === "kit") onTab("kit");
          }}
          items={kitTools.map((entry) => ({
            id: entry.id,
            label: entry.label,
            featured: entry.featured === true,
            href: entry.legacyHref ? hubLegacyHref(entry, orgId) : undefined,
          }))}
        />
      ) : null}

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
