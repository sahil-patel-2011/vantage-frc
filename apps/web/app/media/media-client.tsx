"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SoftAccessDenied } from "../../components/hub-access-gate";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { AIAttribution, EmptyState, PageHeader, Panel, TabBar, ToolStrip } from "../../components/ui";
import {
  formatMediaMetric,
  isMediaReminderOverdue,
  mediaCalendarItems,
  mediaDraftItems,
  mediaReadinessPct,
  mediaReminderItems,
  shouldShowMediaSummaryTiles,
  type MediaContentItem,
  type MediaContentPlatform,
  type MediaHubTab,
  type MediaPostDraftResult,
  MEDIA_CONTENT_PLATFORMS,
  MEDIA_HUB_TABS,
} from "../../lib/media";
import type { MediaView } from "../../lib/media/compute-media";
import {
  MEDIA_RELATED_INCLUDE,
  classifyMediaShell,
  mediaNextActions,
  mediaRelatedLinks,
  mediaSetupSteps,
  mediaShellCopy,
  type MediaNextAction,
  type MediaShellKind,
} from "../../lib/media/media-related";
import {
  clientCanAccessHub,
  filterTabsByHubAccess,
} from "../../lib/nav/hub-access-filter";
import { hubById, hubLegacyHref, hubNestedTabs, hubPrimaryTabs, isHubTab } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./media.css";

const MEDIA_HUB = hubById("media");
const PRIMARY_TABS = hubPrimaryTabs(MEDIA_HUB);
/** Tools nested under Kit — the Kit root itself stays in the tab bar above. */
const kitTools = hubNestedTabs(MEDIA_HUB, "kit").filter((entry) => entry.group === "kit");

type Tab = MediaHubTab;

const TABS: Array<{ id: Tab; label: string }> = PRIMARY_TABS.map((tab) => ({
  id: tab.id as Tab,
  label: tab.label,
}));

type LiveView = Extract<MediaView, { status: "live" }>;

type LiveWithDraft = LiveView & { draft?: MediaPostDraftResult };

function isTab(value: string | null): value is Tab {
  return Boolean(value && MEDIA_HUB_TABS.includes(value as Tab) && isHubTab(MEDIA_HUB, value));
}

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "calendar";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isTab(tab) ? tab : "calendar";
}

function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "calendar") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fromLocalInputValue(value: string): string | null {
  if (!value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Cross-*hub* destinations only.
 *
 * The strip used to carry Media Kit and Community Impact as well, both of which
 * this page already owns: Kit and Impact are tabs one row down, and the Impact
 * panel has its own "Open Community Impact" button that points at `/impact`
 * rather than the Business tab — so the header offered a second control with the
 * same name and a different destination. What is left is the two surfaces that
 * genuinely live in another hub.
 */
const MEDIA_CROSS_HUB_LINKS = MEDIA_RELATED_INCLUDE.filter(
  (id) => id === "outreach-calendar" || id === "sponsor-wall",
);

function MediaRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = mediaRelatedLinks(orgId, { include: MEDIA_CROSS_HUB_LINKS });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related media-related" aria-label="Related media tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function MediaNextActionsPanel({ actions }: { actions: MediaNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions media-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MediaShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MediaShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = mediaNextActions({ orgId, shell });
  const copy = mediaShellCopy(shell);
  const steps = shell === "setup" ? mediaSetupSteps(orgId) : [];
  // A signed-out tablet needs "Sign in again", not a Retry that can never succeed.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page media-page soft-gate">
      <PageHeader breadcrumbs="Media" title="Media" description={description}>
        <div className="media-header-actions">
          <MediaRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No media yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Choose your team
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={orgId ? withOrgHref("/media-kit", orgId) : "/media-kit"}>
              Build Media Kit
            </a>
            <button type="button" className="app-button secondary" onClick={onRetry}>
              Refresh
            </button>
          </>
        ) : null}
      </EmptyState>
      {shell === "setup" && steps.length > 0 ? (
        <ol className="strategy-setup-steps">
          {steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href}>Open</a>
            </li>
          ))}
        </ol>
      ) : null}
      <MediaNextActionsPanel actions={actions} />
    </main>
  );
}

function ContentItemRow({
  item,
  actions,
}: {
  item: MediaContentItem;
  actions?: ReactNode;
}) {
  return (
    <li className="media-item-row">
      <div>
        <strong>{item.title}</strong>
        <span className="app-muted">
          {item.platform} · {item.kind} · {item.status}
          {item.dueAt ? ` · due ${formatWhen(item.dueAt)}` : ""}
          {item.remindAt ? ` · remind ${formatWhen(item.remindAt)}` : ""}
        </span>
        {item.caption ? <p className="media-item-caption">{item.caption}</p> : null}
      </div>
      {actions ? <div className="media-item-actions">{actions}</div> : null}
    </li>
  );
}

function CalendarPanel({
  view,
  busy,
  onCreate,
  onMarkPosted,
}: {
  view: LiveView;
  busy: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onMarkPosted: (itemId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<MediaContentPlatform>("instagram");
  const [dueAt, setDueAt] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const items = mediaCalendarItems(view.items);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await onCreate({
      action: "create-item",
      tab: "calendar",
      title,
      platform,
      status: "scheduled",
      dueAt: fromLocalInputValue(dueAt),
      remindAt: fromLocalInputValue(remindAt),
    });
    if (ok) {
      setTitle("");
      setDueAt("");
      setRemindAt("");
    }
  }

  return (
    <div className="media-tab-panel">
      <Panel>
        <header>
          <h2>Content calendar</h2>
          <p className="app-muted">
            Scheduled and due posts for {view.seasonYear}
          </p>
        </header>
        {items.length ? (
          <ul className="media-panel-list">
            {items.map((item) => (
              <ContentItemRow
                key={item.id}
                item={item}
                actions={
                  item.status !== "posted" ? (
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() => void onMarkPosted(item.id)}
                    >
                      Mark posted
                    </button>
                  ) : null
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            soft
            badge="No scheduled posts"
            badgeTone="setup"
            title="Schedule your first post"
            description="Add a title and due time — the calendar stays empty until you record real posts."
          />
        )}
      </Panel>

      <Panel>
        <header>
          <h2>Schedule a post</h2>
          <p className="app-muted">Creates a scheduled content item for your team.</p>
        </header>
        <form className="media-form" onSubmit={(event) => void submit(event)}>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              placeholder="Kickoff reveal reel"
            />
          </label>
          <label>
            Platform
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as MediaContentPlatform)}
            >
              {MEDIA_CONTENT_PLATFORMS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              required
            />
          </label>
          <label>
            Remind at
            <input
              type="datetime-local"
              value={remindAt}
              onChange={(event) => setRemindAt(event.target.value)}
            />
          </label>
          <button type="submit" className="app-button" disabled={busy || !title.trim()}>
            Schedule
          </button>
        </form>
      </Panel>
    </div>
  );
}

function DraftsPanel({
  view,
  busy,
  cutoffCode,
  draftMeta,
  onCreate,
  onAiDraft,
  onMarkPosted,
}: {
  view: LiveView;
  busy: boolean;
  cutoffCode: string | null;
  draftMeta: { feature: string; generatedAt: string } | null;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onAiDraft: (payload: Record<string, unknown>) => Promise<void>;
  onMarkPosted: (itemId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<MediaContentPlatform>("instagram");
  const [notes, setNotes] = useState("");
  const [caption, setCaption] = useState("");
  const items = mediaDraftItems(view.items);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await onCreate({
      action: "create-item",
      tab: "drafts",
      title,
      platform,
      status: "draft",
      caption: caption || notes || null,
    });
    if (ok) {
      setTitle("");
      setNotes("");
      setCaption("");
    }
  }

  return (
    <div className="media-tab-panel">
      <Panel>
        <header>
          <h2>Drafts</h2>
          <p className="app-muted">Work-in-progress captions.</p>
        </header>
        {view.orgId && cutoffCode ? (
          <UsageCutoffBanner orgId={view.orgId} errorCode={cutoffCode} compact />
        ) : null}
        {draftMeta ? (
          <AIAttribution kind="computed" feature={draftMeta.feature} generatedAt={draftMeta.generatedAt} />
        ) : null}
        {items.length ? (
          <ul className="media-panel-list">
            {items.map((item) => (
              <ContentItemRow
                key={item.id}
                item={item}
                actions={
                  <>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() =>
                        void onAiDraft({
                          action: "ai-draft",
                          tab: "drafts",
                          itemId: item.id,
                          title: item.title,
                          platform: item.platform,
                          notes: item.caption,
                        })
                      }
                    >
                      Suggest caption
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() => void onMarkPosted(item.id)}
                    >
                      Mark posted
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            soft
            badge="No drafts"
            badgeTone="setup"
            title="Start a draft"
            description="Titles and captions stay blank until you write them."
          />
        )}
      </Panel>

      <Panel>
        <header>
          <h2>New draft</h2>
          <p className="app-muted">Save a draft, or generate a starter caption computed from your title and notes.</p>
        </header>
        <form className="media-form" onSubmit={(event) => void submit(event)}>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              placeholder="Build season update"
            />
          </label>
          <label>
            Platform
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as MediaContentPlatform)}
            >
              {MEDIA_CONTENT_PLATFORMS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Talking points for the caption"
            />
          </label>
          <label>
            Caption
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Optional — or use Suggest caption"
            />
          </label>
          <div className="media-form-actions">
            <button type="submit" className="app-button" disabled={busy || !title.trim()}>
              Save draft
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || (!title.trim() && !notes.trim())}
              onClick={() =>
                void onAiDraft({
                  action: "ai-draft",
                  tab: "drafts",
                  title,
                  platform,
                  notes,
                }).then(() => undefined)
              }
            >
              Suggest caption
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function RemindersPanel({
  view,
  busy,
  onDismiss,
}: {
  view: LiveView;
  busy: boolean;
  onDismiss: (itemId: string) => Promise<void>;
}) {
  const items = mediaReminderItems(view.items);
  const now = new Date();

  return (
    <Panel>
      <header>
        <h2>Reminders</h2>
        <p className="app-muted">
          Upcoming and overdue remind_at flags — due reminders also create in-app notifications.
        </p>
      </header>
      {items.length ? (
        <ul className="media-panel-list">
          {items.map((item) => (
            <ContentItemRow
              key={item.id}
              item={item}
              actions={
                <>
                  <span className={isMediaReminderOverdue(item, now) ? "media-overdue" : "app-muted"}>
                    {isMediaReminderOverdue(item, now) ? "Overdue" : "Upcoming"}
                  </span>
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => void onDismiss(item.id)}
                  >
                    Dismiss
                  </button>
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          soft
          badge="No reminders"
          badgeTone="setup"
          title="No upcoming media reminders"
          description="Set remind_at when scheduling or drafting."
        />
      )}
    </Panel>
  );
}

function KitPanel({ view }: { view: LiveView }) {
  const kitHref = withOrgHref("/media-kit", view.orgId);
  return (
    <Panel>
      <header>
        <h2>Media Kit readiness</h2>
        <p className="app-muted">
          {view.kit.readinessTier === "ready"
            ? "Profile and logo recorded — open Media Kit to edit."
            : view.kit.missingFields.length
              ? `Still missing: ${view.kit.missingFields.slice(0, 3).join(", ")}${view.kit.missingFields.length > 3 ? "…" : ""}`
              : "No kit fields yet."}
        </p>
      </header>
      <div className="media-stats" aria-label="Kit readiness">
        <div>
          <strong>{mediaReadinessPct(view.kit.readinessScore)}</strong>
          <span className="app-muted"> Ready</span>
        </div>
        <div>
          <strong>{formatMediaMetric(view.kit.assetCount, true)}</strong>
          <span className="app-muted"> Assets</span>
        </div>
        <div>
          <strong>{formatMediaMetric(view.kit.logoCount, true)}</strong>
          <span className="app-muted"> Logos</span>
        </div>
        <div>
          <strong>{formatMediaMetric(view.kit.documentCount, true)}</strong>
          <span className="app-muted"> One-pagers</span>
        </div>
      </div>
      {view.kit.recentAssets.length ? (
        <ul className="media-panel-list">
          {view.kit.recentAssets.map((asset) => (
            <li key={asset.id}>
              <div>
                <strong>{asset.title}</strong>
                <span className="app-muted">{asset.kind}</span>
              </div>
              <a className="app-button secondary" href={asset.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">Asset library is empty until you add real URLs.</p>
      )}
      {/* One primary action out of the panel. Media library is a tool *inside*
          this workbench, so it belongs in the tool strip above — it was listed
          in both places. */}
      <div className="media-kit-actions">
        <a className="app-button" href={kitHref}>
          Open Media Kit
        </a>
      </div>
    </Panel>
  );
}

function ImpactPanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <header>
        <h2>Media impact</h2>
        <p className="app-muted">Logged activities with category media.</p>
      </header>
      <div className="media-stats" aria-label="Media impact">
        <div>
          <strong>{formatMediaMetric(view.impact.mediaActivityCount, true)}</strong>
          <span className="app-muted"> Activities</span>
        </div>
        <div>
          <strong>{formatMediaMetric(view.impact.peopleReached, true)}</strong>
          <span className="app-muted"> People reached</span>
        </div>
      </div>
      {view.impact.recent.length ? (
        <ul className="media-panel-list">
          {view.impact.recent.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.title}</strong>
                <span className="app-muted">
                  {row.occurredOn} · {formatMediaMetric(row.peopleReached, true)} reached
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          soft
          badge="No impact logs"
          badgeTone="setup"
          title="No media-category impact yet"
          description="People reached stays blank until you log real activities."
        />
      )}
      <a className="app-button" href={withOrgHref("/impact", view.orgId)}>
        Open Community Impact
      </a>
    </Panel>
  );
}

function LiveMediaWorkspace({
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

export default function MediaClient() {
  const access = useClientAccessProfile();
  const [view, setView] = useState<MediaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("calendar");
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ feature: string; generatedAt: string } | null>(null);

  const visibleTabs = useMemo(
    () => filterTabsByHubAccess(TABS, access.hubAccess, "media"),
    [access.hubAccess],
  );
  const hubDenied = access.ready && !clientCanAccessHub(access.hubAccess, "media");

  const load = useCallback(() => {
    setFetchFailed(false);
    setErrorStatus(null);
    setAccessDenied(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = params.get("season") ? Number(params.get("season")) : null;
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    const currentTab = readTabFromUrl();
    if (currentTab !== "calendar") query.set("tab", currentTab);
    void fetch(`/api/media${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MediaView | { error?: string };
        if (response.status === 403) {
          setAccessDenied(true);
          setError("error" in data && data.error ? data.error : "You do not have access to this tab");
          return;
        }
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setFetchFailed(true);
          setError("error" in data && data.error ? data.error : "Could not load Media");
          return;
        }
        setView(data);
      })
      .catch(() => {
        setFetchFailed(true);
        setError("Could not load Media");
      });
  }, []);

  useEffect(() => {
    setTab(readTabFromUrl());
    load();
  }, [load]);

  useEffect(() => {
    if (!access.ready || !visibleTabs.length) return;
    if (visibleTabs.some((entry) => entry.id === tab)) return;
    const fallback = (visibleTabs[0]?.id as Tab) ?? "calendar";
    setTab(fallback);
    writeTabToUrl(fallback);
  }, [access.ready, tab, visibleTabs]);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    writeTabToUrl(next);
  }, []);

  const mutate = useCallback(
    async (payload: Record<string, unknown>, method: "POST" | "PATCH" | "DELETE" = "POST") => {
      if (!view || view.status !== "live" || busy) return false;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/media", {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId: view.orgId,
            seasonYear: view.seasonYear,
            ...payload,
          }),
        });
        const data = (await response.json()) as
          | LiveWithDraft
          | { error?: string; code?: string; status?: string };
        if (!response.ok) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return false;
          }
          setError("error" in data && data.error ? data.error : "Media update failed");
          return false;
        }
        if (!("status" in data) || data.status !== "live") {
          setError("error" in data && data.error ? data.error : "Media update failed");
          return false;
        }
        const live = data as LiveWithDraft;
        if (live.draft?.status === "setup_required") {
          setError(live.draft.message);
          setView(live);
          return false;
        }
        if (
          live.draft?.status === "live" &&
          payload.action === "ai-draft" &&
          !payload.itemId &&
          typeof payload.title === "string" &&
          payload.title.trim()
        ) {
          setDraftMeta({ feature: live.draft.feature, generatedAt: live.draft.generatedAt });
          const createResponse = await fetch("/api/media", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              orgId: view.orgId,
              seasonYear: view.seasonYear,
              action: "create-item",
              tab: "drafts",
              title: payload.title,
              platform: payload.platform ?? "other",
              status: "draft",
              caption: live.draft.caption,
              dueAt: live.draft.dueAt,
            }),
          });
          const created = (await createResponse.json()) as MediaView | { error?: string };
          if (!createResponse.ok || !("status" in created) || created.status !== "live") {
            setError("error" in created && created.error ? created.error : "Could not save AI draft");
            setView(live);
            return false;
          }
          setView(created);
          return true;
        }
        if (live.draft?.status === "live") {
          setDraftMeta({ feature: live.draft.feature, generatedAt: live.draft.generatedAt });
        }
        setView(live);
        return true;
      } catch {
        setError("Media update failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, view],
  );

  const orgId = view && "orgId" in view ? view.orgId : null;
  const kit = view?.status === "live" ? view.kit : null;
  const outreach = view?.status === "live" ? view.outreach : null;
  const impact = view?.status === "live" ? view.impact : null;
  const sponsorWall = view?.status === "live" ? view.sponsorWall : null;
  const items = view?.status === "live" ? view.items : [];

  const shell = classifyMediaShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    assetCount: kit?.assetCount,
    documentCount: kit?.documentCount,
    readinessScore: kit?.readinessScore,
    upcomingCount: outreach?.upcomingCount,
    mediaCategoryCount: outreach?.mediaCategoryCount,
    mediaActivityCount: impact?.mediaActivityCount,
    publishedEntryCount: sponsorWall?.publishedEntryCount,
    itemCount: items.length,
  });

  // Live org always gets the TabBar hub so users can create the first draft/schedule.
  if (hubDenied || accessDenied) {
    return (
      <SoftAccessDenied
        breadcrumbs="Media"
        title="Media"
        heading={hubDenied ? "Media is not available" : "This Media tab is not available"}
        description={
          error ||
          "Your team admin limited which Media sections you can open. Ask an owner to update section access under Team → Security."
        }
      />
    );
  }

  if (view?.status === "live") {
    return (
      <LiveMediaWorkspace
        view={view}
        tab={tab}
        onTab={selectTab}
        tabs={visibleTabs}
        busy={busy}
        error={error}
        cutoffCode={cutoffCode}
        draftMeta={draftMeta}
        mutate={mutate}
      />
    );
  }

  return (
    <MediaShell
      description="Content calendar, drafts, reminders, Media Kit, and impact."
      orgId={orgId}
      shell={shell === "ready" ? "empty" : shell}
      error={error || undefined}
      errorStatus={errorStatus}
      onRetry={load}
    />
  );
}
