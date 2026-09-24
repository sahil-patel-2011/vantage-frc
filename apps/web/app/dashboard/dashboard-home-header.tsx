"use client";

import { useState } from "react";
import { orgNameAddsDetail } from "../../components/app-shell-model";
import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { DashboardBoardSwitcher } from "./dashboard-board-bar";
import type { BoardMeta, BoardState, Me } from "./dashboard-board-types";
import { LiveCountdown } from "./widgets";

/**
 * Copies a link to this Home. It used to be the only item in a "More" menu
 * (plus the sync time), a whole extra tap for one action, in a pill that sat
 * higher and shorter than Edit beside it. Now it is a 44px icon button the same
 * height as Edit, and the sync time is at the foot of the page.
 */
export function DashboardShareButton({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    const href = withOrgHref(`${window.location.pathname}${window.location.search}`, orgId || null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus("idle"), 2000);
  }
  const label = status === "copied" ? "Link copied" : status === "failed" ? "Copy failed" : "Copy a link to Home";
  return (
    <button
      type="button"
      className="dash-share-button"
      data-testid="dash-share"
      data-status={status}
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      {status === "copied" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 15V4m0 0L8 8m4-4 4 4M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="dash-live-region" aria-live="polite">
        {status === "idle" ? "" : label}
      </span>
    </button>
  );
}

export function DashboardHomeHeader({
  me,
  meLoaded,
  orgId,
  greetingText,
  board,
  switcherBoards,
  saving,
  editing,
  previewing,
  detail,
  eventName,
  nextMatchData,
  showNextGlance,
  onSwitch,
  onNewBoard,
  onManageBoards,
  onEdit,
}: {
  me: Me;
  meLoaded: boolean;
  orgId: string;
  greetingText: string;
  board: BoardState | null;
  switcherBoards: BoardMeta[];
  saving: boolean;
  editing: boolean;
  previewing: boolean;
  detail: string;
  eventName: unknown;
  nextMatchData: Record<string, unknown> | undefined;
  showNextGlance: boolean;
  onSwitch: (id: string) => void;
  onNewBoard: () => void;
  onManageBoards: () => void;
  onEdit: () => void;
}) {
  const dim = editing ? ({ inert: true, "data-edit-dim": "true" } as const) : {};
  return (
    <header className="dash-home-header">
      <div {...dim}>
        {/* The greeting is what is specific to opening the page; the team number is in the
            top bar on every page, so it is not repeated here. */}
        <h1 className="dash-hero-greeting">{greetingText}</h1>
        {orgId && meLoaded ? (
          <DashboardBoardSwitcher
            boards={switcherBoards}
            board={board}
            saving={saving}
            disabled={editing || previewing}
            onSwitch={onSwitch}
            onNew={onNewBoard}
            onManage={onManageBoards}
          />
        ) : null}
        {me.teamNumber && orgNameAddsDetail(me.teamNumber, me.orgName) ? <p className="dash-hero-org">{me.orgName}</p> : null}
        {detail ? <p>{detail}</p> : null}
        {/* The event you are at, as its own row you can tap. Absent until an event is set. */}
        {typeof eventName === "string" && eventName.trim() ? (
          <a className="dash-hero-event" data-tour="event" href={withOrgHref("/command", orgId || null)}>
            <Icon name="pin" />
            <span>{eventName}</span>
            <Icon name="chevron" />
          </a>
        ) : null}
      </div>
      {!editing && !previewing ? (
        <div className="dash-home-actions">
          {nextMatchData && showNextGlance ? (
            <a className="dash-next-glance" href={withOrgHref("/my-day", orgId || null)}>
              <span>Next</span>
              <strong>
                {String(nextMatchData.compLevel ?? "Match").toUpperCase()} {String(nextMatchData.matchNumber ?? "")}
              </strong>
              <b>
                <LiveCountdown iso={nextMatchData.scheduledTime as string | undefined} />
              </b>
            </a>
          ) : null}
          {/* A quiet "Edit" beside the greeting, the way iOS does it. */}
          <button
            type="button"
            className="dash-edit-button"
            data-testid="dash-customize"
            data-tour="customise"
            aria-label="Edit Home — rearrange, add, or remove widgets"
            onClick={onEdit}
          >
            Edit
          </button>
          {orgId ? <DashboardShareButton orgId={orgId} /> : null}
        </div>
      ) : null}
    </header>
  );
}
