"use client";

import type { BoardMeta } from "./dashboard-board-types";

export function DashboardBoardBar({
  boards,
  activeId,
  saving,
  editing,
  managing,
  onSwitch,
  onCreatePersonal,
  onManage,
}: {
  boards: BoardMeta[];
  activeId?: string | null;
  saving: boolean;
  editing: boolean;
  managing: boolean;
  onSwitch: (id: string) => void;
  onCreatePersonal: () => void;
  onManage: () => void;
}) {
  if (boards.length <= 1) return null;
  return (
    <div className="dash-board-bar" role="navigation" aria-label="Dashboard boards">
      <div className="dash-board-switcher" data-testid="dash-board-switcher">
        {boards.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={activeId === item.id}
            disabled={saving || editing}
            onClick={() => onSwitch(item.id)}
            title={item.scope === "org" ? "Team board" : "Personal board"}
          >
            {item.name}
          </button>
        ))}
        <button
          type="button"
          className="dash-board-add"
          disabled={saving || editing}
          aria-label="Create personal board"
          title="New personal board"
          onClick={onCreatePersonal}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="dash-board-manage"
        data-testid="dash-manage-boards"
        disabled={saving}
        aria-expanded={managing}
        onClick={onManage}
      >
        Manage boards
      </button>
    </div>
  );
}
