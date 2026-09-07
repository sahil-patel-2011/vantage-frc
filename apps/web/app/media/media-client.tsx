"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { HubTabForbidden } from "../../components/hub-access-gate";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { AIAttribution, EmptyState, Panel, ToolPage, useToast, type ShellState } from "../../components/ui";
import { attributionKindForRenderMode } from "../../components/ui/ai-attribution-policy";
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
  classifyMediaShell,
  mediaNextActions,
  mediaSetupSteps,
  mediaShellCopy,
  type MediaNextAction,
  type MediaShellKind,
} from "../../lib/media/media-related";
import { hubById } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./media.css";

const MEDIA_HUB = hubById("media");

type Tab = MediaHubTab;

type LiveView = Extract<MediaView, { status: "live" }>;

type LiveWithDraft = LiveView & { draft?: MediaPostDraftResult };

/** Success toast after a saved mutation, keyed by the request action. */
const SAVED_COPY: Record<string, string> = {
  "create-item": "Saved to your media calendar.",
  "mark-posted": "Marked as posted.",
  "dismiss-reminder": "Reminder dismissed.",
  "ai-draft": "Caption suggested — review it before posting.",
};

/** The hub keeps ?tab= in sync; the API call scopes reminders/drafts by it. */
function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "calendar";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab && (MEDIA_HUB_TABS as readonly string[]).includes(tab) ? (tab as Tab) : "calendar";
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

function MediaNextActionsPanel({ actions }: { actions: MediaNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions media-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Calendar, drafts, kit, and impact — never DEMO media metrics.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MediaShell({
  tab,
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
}: {
  tab: Tab;
  description: string;
  orgId?: string | null;
  shell: Exclude<MediaShellKind, "ready">;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
}) {
  const actions = mediaNextActions({ orgId, shell });
  const copy = mediaShellCopy(shell);
  const steps = shell === "setup" ? mediaSetupSteps(orgId) : [];
  const state: ShellState = shell;
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const kitHref = orgId ? withOrgHref("/media-kit", orgId) : "/media-kit";

  // A signed-out tablet needs "Sign in again", not a Retry that can never
  // succeed — ErrorState classifies the status + message and picks the action.
  return (
    <>
      <ToolPage
        hub="media"
        hubTab={tab}
        title="Media"
        description={description}
        embedded
        className="media-page"
        orgId={orgId}
        state={state}
        error={{ message: error, status: errorStatus }}
        onRetry={onRetry}
        loading={
          <EmptyState soft badge={copy.badge} title={copy.title} description={copy.description} aria-busy />
        }
        setup={
          <EmptyState soft badge="Setup required" badgeTone="setup" title={copy.title} description={copy.description}>
            <a className="app-button" href={workspaceHref}>
              Open Workspace
            </a>
            {steps.length > 0 ? (
              <ol className="strategy-setup-steps">
                {steps.map((step) => (
                  <li key={step.id}>
                    <div>
                      <strong>{step.label}</strong>
                      <span>{step.detail}</span>
                    </div>
                    <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
                  </li>
                ))}
              </ol>
            ) : null}
          </EmptyState>
        }
        empty={
          <EmptyState soft badge="No media yet" badgeTone="setup" title={copy.title} description={copy.description}>
            <a className="app-button" href={kitHref}>
              Build Media Kit
            </a>
            <button type="button" className="app-button secondary" onClick={onRetry}>
              Refresh
            </button>
          </EmptyState>
        }
      />
      <MediaNextActionsPanel actions={actions} />
    </>
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
            Scheduled and due posts for {view.seasonYear} — never DEMO engagement.
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
  draftMeta: { feature: string; generatedAt: string; mode?: "model" | "template" } | null;
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
          <p className="app-muted">Work-in-progress captions — never DEMO reach.</p>
        </header>
        {view.orgId && cutoffCode ? (
          <UsageCutoffBanner orgId={view.orgId} errorCode={cutoffCode} compact />
        ) : null}
        {draftMeta ? (
          <AIAttribution
            kind={attributionKindForRenderMode(draftMeta.mode)}
            feature={draftMeta.feature}
            generatedAt={draftMeta.generatedAt}
          />
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
            description="Titles and captions stay blank until you write them — nothing is pre-seeded."
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
          description="Set remind_at when scheduling or drafting — never invent DEMO alert counts."
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
              : "No kit fields yet — never DEMO bios or logos."}
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
      <a className="app-button" href={kitHref}>
        Open Media Kit
      </a>
    </Panel>
  );
}

function ImpactPanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <header>
        <h2>Media impact</h2>
        <p className="app-muted">Logged activities with category media — never DEMO hours.</p>
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
  busy,
  error,
  cutoffCode,
  draftMeta,
  mutate,
}: {
  view: LiveView;
  tab: Tab;
  busy: boolean;
  error: string;
  cutoffCode: string | null;
  draftMeta: { feature: string; generatedAt: string; mode?: "model" | "template" } | null;
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
    <ToolPage
      hub="media"
      hubTab={tab}
      title="Media"
      description={`${view.orgName}${view.teamNumber != null ? ` · Team ${view.teamNumber}` : ""} · ${view.seasonYear} content calendar, drafts, kit, and impact — recorded rows only.`}
      embedded
      className="media-page"
      orgId={orgId}
      state="ready"
    >
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
    </ToolPage>
  );
}

/**
 * Media workspace body. The hub shell (media-hub.tsx → ProductHubShell) owns
 * the title, TabBar, tool strip, hub-access filtering and the ?tab= URL; this
 * owns the season view and the per-tab panels.
 */
export default function MediaClient({ tab }: { tab: MediaHubTab }) {
  const toast = useToast();
  const [view, setView] = useState<MediaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ feature: string; generatedAt: string; mode?: "model" | "template" } | null>(null);

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
    load();
  }, [load]);

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
          setDraftMeta({
            feature: live.draft.feature,
            generatedAt: live.draft.generatedAt,
            mode: live.draft.render?.mode,
          });
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
          toast.success("Draft saved with the suggested caption.");
          return true;
        }
        if (live.draft?.status === "live") {
          setDraftMeta({
            feature: live.draft.feature,
            generatedAt: live.draft.generatedAt,
            mode: live.draft.render?.mode,
          });
        }
        setView(live);
        const saved = SAVED_COPY[String(payload.action)];
        if (saved) toast.success(saved);
        return true;
      } catch {
        setError("Media update failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, toast, view],
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

  // Hub-level access is enforced by ProductHubShell; a 403 for this one tab
  // renders the same forbidden card the shell uses for a filtered tab.
  if (accessDenied) {
    const active = MEDIA_HUB.tabs.find((entry) => entry.id === tab);
    return <HubTabForbidden hubLabel="Media" tabLabel={active?.label} />;
  }

  if (view?.status === "live") {
    return (
      <LiveMediaWorkspace
        view={view}
        tab={tab}
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
      tab={tab}
      description="Content calendar, drafts, reminders, Media Kit, and impact — never DEMO metrics."
      orgId={orgId}
      shell={shell === "ready" ? "empty" : shell}
      error={error || undefined}
      errorStatus={errorStatus}
      onRetry={load}
    />
  );
}
