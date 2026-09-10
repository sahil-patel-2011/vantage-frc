"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel, type BadgeTone, Button } from "../../components/ui";
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

/**
 * The workspace the shell sent us to.
 *
 * The shell builds every product link with `withOrgHref`, so a member of two
 * teams arrives as `/announcements?orgId=…`. Calling `/api/announcements` bare
 * let the API fall back to the caller's first membership ordered by org name —
 * so an owner of two teams could post to the wrong one and not know.
 */
function orgParam(): string {
  if (typeof window === "undefined") return "";
  const orgId = new URLSearchParams(window.location.search).get("orgId");
  return orgId ? `orgId=${encodeURIComponent(orgId)}` : "";
}

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
  // What actually left the building. The poster is about to walk away assuming
  // everyone has been told, so "emailed 9 of 30, 21 have this off" belongs on
  // screen rather than in a log nobody reads.
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const query = orgParam();
      const response = await fetch(`/api/announcements${query ? `?${query}` : ""}`);
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
      const query = orgParam();
      const response = await fetch(`/api/announcements${query ? `?${query}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string; emailSummary?: string };
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setError("");
      setNotice(data.emailSummary ?? "");
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function showOutstanding(id: string) {
    const query = orgParam();
    const response = await fetch(
      `/api/announcements?outstandingFor=${encodeURIComponent(id)}${query ? `&${query}` : ""}`,
    );
    const data = (await response.json()) as { outstanding?: string[] };
    setOutstanding({ id, names: data.outstanding ?? [] });
  }

  if (error && !view) {
    return (
      <main className="module-page announcements-page">
        <PageHeader breadcrumbs="Team / Announcements" title="Announcements" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="Announcements need a team" description={error}>
          <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
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
            <p className="app-muted ann-delivery-note">
              {priority === "urgent" || requireAck
                ? "Everyone gets this in their inbox, and it is also emailed to members who have urgent announcements switched on."
                : "Everyone gets this in their inbox. Mark it urgent, or require confirmation, to email it as well."}
            </p>
            <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
              Post to {view.orgName}
            </Button>
            {error ? <p role="alert" className="ann-error">{error}</p> : null}
            {notice ? <p role="status" className="app-muted ann-delivery-note">{notice}</p> : null}
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
                        <Button variant="primary" type="button" disabled={busy} onClick={() => void act({ action: "acknowledge", announcementId: item.id })}>
                          I have read this
                        </Button>
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
