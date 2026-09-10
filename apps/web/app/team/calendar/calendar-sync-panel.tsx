"use client";

import { useState } from "react";
import { Button } from "../../../components/ui";
import {
  googleCalendarSubscribeUrl,
  toWebcalUrl,
} from "../../../lib/calendar-ics";
import type {
  CalendarFeedScope,
  GitHubCalendarOverlay,
  Subteam,
} from "../../../lib/subteam-calendar";
import { GitHubCalendarHint } from "./github-calendar-hint";
import type { ActionBody } from "./calendar-model";

export function CalendarSyncPanel({
  orgId,
  subteams,
  feedToken,
  scope,
  subteamId,
  github,
  onScopeChange,
  onSubteamChange,
  busyKey,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  feedToken: string | null;
  scope: CalendarFeedScope;
  subteamId: string;
  github: GitHubCalendarOverlay | undefined;
  onScopeChange: (scope: CalendarFeedScope) => void;
  onSubteamChange: (subteamId: string) => void;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const busy = busyKey === "cal-feed";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const httpsUrl = feedToken ? `${origin}/api/calendar/feed/${feedToken}` : "";
  const webcalUrl = httpsUrl ? toWebcalUrl(httpsUrl) : "";
  const googleUrl = webcalUrl ? googleCalendarSubscribeUrl(webcalUrl) : "";

  const feedBody = () => ({
    orgId,
    scope,
    subteamId: scope === "subteam" ? subteamId || null : null,
  });

  const copy = async () => {
    if (!httpsUrl) return;
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* selectable input fallback */
    }
  };

  const downloadHref = (() => {
    const params = new URLSearchParams({ orgId, format: "ics", scope });
    if (scope === "subteam" && subteamId) params.set("subteamId", subteamId);
    return `/api/team/calendar?${params.toString()}`;
  })();

  return (
    <section className="soft-panel tc-sync" aria-labelledby="tc-sync-title">
      <div className="tc-sync-head">
        <div>
          <h2 id="tc-sync-title">Phone calendar</h2>
          <p className="app-muted">Subscribe in Google or Apple Calendar.</p>
        </div>
      </div>

      <div className="tc-sync-grid">
        <label>
          Feed
          <select
            value={scope}
            disabled={busy}
            onChange={(event) => onScopeChange(event.target.value as CalendarFeedScope)}
          >
            <option value="personal">Personal (my subteams + whole team)</option>
            <option value="org">Whole team (every subteam)</option>
            <option value="subteam">One subteam</option>
          </select>
        </label>
        {scope === "subteam" ? (
          <label>
            Subteam
            <select
              value={subteamId}
              disabled={busy}
              onChange={(event) => onSubteamChange(event.target.value)}
            >
              <option value="">Select subteam…</option>
              {subteams.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {feedToken && httpsUrl ? (
        <>
          <label className="tc-sync-url">
            Subscribe URL
            <div className="tc-sync-url-row">
              <input readOnly value={httpsUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar feed URL" />
              <Button variant="secondary" type="button" disabled={busy} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </label>
          <div className="tc-sync-actions">
            <Button as="a" variant="primary" href={webcalUrl}>
              Add to Apple Calendar
            </Button>
            <Button as="a" variant="secondary" href={googleUrl} target="_blank" rel="noreferrer">
              Add to Google Calendar
            </Button>
            <Button as="a" variant="secondary" href={downloadHref}>
              Download .ics
            </Button>
          </div>
          <div className="tc-sync-actions">
            <button
              type="button"
              className="tc-text-btn"
              disabled={busy || (scope === "subteam" && !subteamId)}
              onClick={() => {
                if (
                  confirm(
                    "Generate a new link? Your current subscription will stop updating until you re-add the new one.",
                  )
                ) {
                  void run({ action: "rotate_calendar_feed", ...feedBody() }, "cal-feed");
                }
              }}
            >
              Regenerate link
            </button>
            <button
              type="button"
              className="tc-text-btn danger"
              disabled={busy}
              onClick={() => {
                if (confirm("Turn off this calendar subscription? The link will stop working.")) {
                  void run({ action: "disable_calendar_feed", ...feedBody() }, "cal-feed");
                }
              }}
            >
              Turn off
            </button>
          </div>
        </>
      ) : (
        <div className="tc-sync-actions">
          <Button variant="primary" type="button" disabled={busy || (scope === "subteam" && !subteamId)} onClick={() => void run({ action: "ensure_calendar_feed", ...feedBody() }, "cal-feed")}>
            Create my subscribe link
          </Button>
          <Button as="a" variant="secondary" href={downloadHref}>
            Download .ics once
          </Button>
        </div>
      )}

      <GitHubCalendarHint overlay={github} orgId={orgId} />
    </section>
  );
}
