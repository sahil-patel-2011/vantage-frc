"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel, type BadgeTone } from "../../components/ui";
import {
  ANNOUNCEMENT_PRIORITIES,
  type Announcement,
  type AnnouncementPriority,
} from "../../lib/announcements/store";
import { formatInstant } from "../../lib/announcements/time";

type View = {
  orgId: string;
  orgName: string;
  canPost: boolean;
  announcements: Announcement[];
};

const PRIORITY_LABEL: Record<AnnouncementPriority, string> = {
  normal: "Normal",
  important: "Important",
  urgent: "Urgent",
};

function priorityTone(priority: AnnouncementPriority): BadgeTone {
  if (priority === "urgent") return "danger";
  if (priority === "important") return "info";
  return "neutral";
}

export default function AnnouncementsClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("normal");
  const [requireAck, setRequireAck] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [outstanding, setOutstanding] = useState<{ id: string; names: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/announcements");
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not load announcements.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setError("");
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function showOutstanding(id: string) {
    const response = await fetch(`/api/announcements?outstandingFor=${encodeURIComponent(id)}`);
    const data = (await response.json()) as { outstanding?: string[] };
    setOutstanding({ id, names: data.outstanding ?? [] });
  }

  if (error && !view) {
    return (
      <main className="module-page announcements-page">
        <PageHeader breadcrumbs="Team / Announcements" title="Announcements" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="Announcements need a team workspace" description={error}>
          <a className="app-button" href="/workspace">Choose team</a>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page announcements-page">
        <PageHeader breadcrumbs="Team / Announcements" title="Announcements" />
        <Panel><p className="app-muted">Loading…</p></Panel>
      </main>
    );
  }

  return (
    <main className="module-page announcements-page">
      <PageHeader
        breadcrumbs="Team / Announcements"
        title="Announcements"
        description={`Post to everyone in ${view.orgName}, and see who has read the things that matter.`}
      />

      {view.canPost ? (
        <Panel className="ann-compose">
          <h2>Post to the team</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              void act({ action: "post", title, body, priority, pinned, requireAck }).then((ok) => {
                if (ok) {
                  setTitle("");
                  setBody("");
                  setPriority("normal");
                  setRequireAck(false);
                  setPinned(false);
                }
              });
            }}
          >
            <label className="ann-field">
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="Bus leaves at 6:15, not 6:45"
              />
            </label>
            <label className="ann-field">
              <span>Details (optional)</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={4000} />
            </label>
            <div className="ann-options">
              <label className="ann-field ann-field-inline">
                <span>Priority</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as AnnouncementPriority)}>
                  {ANNOUNCEMENT_PRIORITIES.map((option) => (
                    <option key={option} value={option}>{PRIORITY_LABEL[option]}</option>
                  ))}
                </select>
              </label>
              <label className="ann-check">
                <input type="checkbox" checked={requireAck} onChange={(event) => setRequireAck(event.target.checked)} />
                Require everyone to confirm they read it
              </label>
              <label className="ann-check">
                <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                Pin to the top
              </label>
            </div>
            <button type="submit" className="app-button" disabled={busy || !title.trim()}>
              Post to {view.orgName}
            </button>
            {error ? <p role="alert" className="ann-error">{error}</p> : null}
          </form>
        </Panel>
      ) : null}

      {view.announcements.length === 0 ? (
        <EmptyState
          soft
          badge="Nothing posted"
          badgeTone="setup"
          title="No announcements yet"
          description={
            view.canPost
              ? "Anything you post here lands in every member's inbox. Use it for the things people cannot afford to miss."
              : "When a lead posts something, it will show up here and in your inbox."
          }
        />
      ) : (
        <Panel className="ann-list-panel">
          <h2>Posted</h2>
          <ul className="ann-list">
            {view.announcements.map((item) => {
              const showing = outstanding?.id === item.id;
              return (
                <li key={item.id} className={item.pinned ? "ann-item pinned" : "ann-item"}>
                  <div className="ann-item-head">
                    <div>
                      <h3>{item.title}</h3>
                      <small className="app-muted">
                        {item.authorName ?? "Vantage"} · {formatInstant(item.createdAt)}
                        {item.pinned ? " · Pinned" : ""}
                      </small>
                    </div>
                    <Badge tone={priorityTone(item.priority)}>{PRIORITY_LABEL[item.priority]}</Badge>
                  </div>

                  {item.body ? <p className="ann-body">{item.body}</p> : null}

                  {item.requireAck ? (
                    <div className="ann-ack">
                      <span className="ann-ack-count">
                        {item.ackCount} of {item.memberCount} confirmed
                      </span>
                      {item.acknowledged ? (
                        <span className="ann-ack-done">You confirmed this</span>
                      ) : (
                        <button
                          type="button"
                          className="app-button"
                          disabled={busy}
                          onClick={() => void act({ action: "acknowledge", announcementId: item.id })}
                        >
                          I have read this
                        </button>
                      )}
                      {view.canPost && item.ackCount < item.memberCount ? (
                        <button
                          type="button"
                          className="text-button"
                          aria-expanded={showing}
                          onClick={() => {
                            // The button labelled "Hide" has to actually hide;
                            // re-calling the loader just refetched the same id.
                            if (showing) setOutstanding(null);
                            else void showOutstanding(item.id);
                          }}
                        >
                          {showing ? "Hide who is missing" : "Who has not confirmed?"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {showing ? (
                    <p className="ann-outstanding">
                      {outstanding.names.length === 0
                        ? "Everyone has confirmed."
                        : `Still to confirm: ${outstanding.names.join(", ")}`}
                    </p>
                  ) : null}

                  {view.canPost ? (
                    <div className="ann-admin">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void act({ action: "pin", announcementId: item.id, pinned: !item.pinned })}
                      >
                        {item.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Delete "${item.title}"?`)) {
                            void act({ action: "delete", announcementId: item.id });
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </main>
  );
}
