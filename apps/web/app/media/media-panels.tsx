"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { AIAttribution, EmptyState, Panel, Button } from "../../components/ui";
import {
  formatMediaMetric,
  isMediaReminderOverdue,
  mediaCalendarItems,
  mediaDraftItems,
  mediaReadinessPct,
  mediaReminderItems,
  type MediaContentItem,
  type MediaContentPlatform,
  MEDIA_CONTENT_PLATFORMS,
} from "../../lib/media";
import { withOrgHref } from "../../lib/nav/product-nav";
import { formatWhen, fromLocalInputValue, type LiveView } from "./media-helpers";

export function ContentItemRow({
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

export function CalendarPanel({
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
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => void onMarkPosted(item.id)}>
                      Mark posted
                    </Button>
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
          <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
            Schedule
          </Button>
        </form>
      </Panel>
    </div>
  );
}

export function DraftsPanel({
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
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => void onAiDraft({ action: "ai-draft", tab: "drafts", itemId: item.id, title: item.title, platform: item.platform, notes: item.caption, }) }>
                      Suggest caption
                    </Button>
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => void onMarkPosted(item.id)}>
                      Mark posted
                    </Button>
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
            <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
              Save draft
            </Button>
            <Button variant="secondary" type="button" disabled={busy || (!title.trim() && !notes.trim())} onClick={() => void onAiDraft({ action: "ai-draft", tab: "drafts", title, platform, notes, }).then(() => undefined) }>
              Suggest caption
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export function RemindersPanel({
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
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => void onDismiss(item.id)}>
                    Dismiss
                  </Button>
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

export function KitPanel({ view }: { view: LiveView }) {
  const kitHref = withOrgHref("/media-kit", view.orgId);
  return (
    <Panel>
      <header>
        <h2>Media kit readiness</h2>
        <p className="app-muted">
          {view.kit.readinessTier === "ready"
            ? "Profile and logo recorded — open Media kit to edit."
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
              <Button as="a" variant="secondary" href={asset.url} target="_blank" rel="noreferrer">
                Open
              </Button>
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
        <Button as="a" variant="primary" href={kitHref}>
          Open Media kit
        </Button>
      </div>
    </Panel>
  );
}

export function ImpactPanel({ view }: { view: LiveView }) {
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
      <Button as="a" variant="primary" href={withOrgHref("/impact", view.orgId)}>
        Open Impact
      </Button>
    </Panel>
  );
}
