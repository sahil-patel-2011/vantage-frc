"use client";

import { orgNameAddsDetail } from "../../components/app-shell-model";
import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { DashboardBoardSwitcher } from "./dashboard-board-bar";
import type { BoardMeta, BoardState, Me } from "./dashboard-board-types";
import { LiveCountdown } from "./widgets";

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
        </div>
      ) : null}
    </header>
  );
}
