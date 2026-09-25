"use client";

import { useState } from "react";
import { Modal } from "../../components/ui";
import { suggestBoardName } from "../../lib/dashboard/edit-mode";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

/*
  "Board" everywhere. This dialog was titled "Home Screens", opened from a
  "Manage boards" button, and created boards called "My dashboard" — three
  names for one thing. A board is one arrangement of Home; you can have a few
  (say, one for match day) and switch between them.
*/

export function DashboardBoardsModal({
  open,
  onClose,
  board,
  personalBoards,
  orgBoards,
  saving,
  editing,
  canShareOrg,
  renameId,
  renameDraft,
  onRenameDraft,
  onSwitch,
  onRename,
  onDuplicate,
  onDelete,
  onStartRename,
  onCancelRename,
  onCreatePersonal,
  onCreateOrg,
  initialCreate = null,
}: {
  open: boolean;
  onClose: () => void;
  board: BoardState | null;
  personalBoards: BoardMeta[];
  orgBoards: BoardMeta[];
  saving: boolean;
  editing: boolean;
  canShareOrg: boolean;
  renameId: string | null;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onCreatePersonal: (name: string) => void;
  onCreateOrg: (name: string) => void;
  /** Open straight into "name your new board" (the + beside the board tabs). */
  initialCreate?: "personal" | "org" | null;
}) {
  const allNames = [...personalBoards, ...orgBoards].map((item) => item.name);
  const [creating, setCreating] = useState<"personal" | "org" | null>(initialCreate);
  const [newName, setNewName] = useState(() => suggestBoardName(allNames));

  function startCreate(scope: "personal" | "org") {
    setCreating(scope);
    setNewName(suggestBoardName(allNames));
  }

  function createForm(scope: "personal" | "org") {
    if (creating !== scope) return null;
    return (
      <form
        className="dash-boards-new"
        data-testid="dash-new-board-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          setCreating(null);
          if (scope === "org") onCreateOrg(name);
          else onCreatePersonal(name);
        }}
      >
        <label>
          <span>Name your new {scope === "org" ? "team " : ""}board</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={80}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Board name"
            data-testid="dash-new-board-name"
          />
        </label>
        <div className="dash-boards-actions">
          <button type="button" onClick={() => setCreating(null)}>
            Cancel
          </button>
          <button type="submit" className="is-primary" disabled={saving || !newName.trim()}>
            Create
          </button>
        </div>
      </form>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your boards"
      description="Each board is its own arrangement of Home. Yours are private; team boards are shared with everyone, and owners and admins edit them."
      className="dash-boards-dialog"
    >
      <section className="dash-boards-group">
        <p>Yours</p>
        {personalBoards.length === 0 ? (
          <p className="dash-library-empty">No boards of your own yet. Make one for match day, build season, or anything else.</p>
        ) : (
          <ul className="dash-boards-list">
            {personalBoards.map((item) => (
              <li key={item.id} data-active={board?.id === item.id ? "true" : "false"}>
                {renameId === item.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRename(item.id, renameDraft);
                    }}
                  >
                    <input
                      value={renameDraft}
                      onChange={(event) => onRenameDraft(event.target.value)}
                      maxLength={80}
                      autoFocus
                      aria-label="Board name"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="dash-board-pick"
                    disabled={saving || editing}
                    onClick={() => onSwitch(item.id)}
                  >
                    <strong>{item.name}</strong>
                    <span>{board?.id === item.id ? "Showing now" : "Open"}</span>
                  </button>
                )}
                <div className="dash-boards-actions">
                  {renameId === item.id ? (
                    <>
                      <button type="button" disabled={saving} onClick={() => onRename(item.id, renameDraft)}>
                        Save
                      </button>
                      <button type="button" disabled={saving} onClick={onCancelRename}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={saving} onClick={() => onStartRename(item.id, item.name)}>
                        Rename
                      </button>
                      <button
                        type="button"
                        data-testid="dash-duplicate-board"
                        disabled={saving || editing}
                        onClick={() => onDuplicate(item.id)}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={saving}
                        aria-label={`Delete ${item.name}`}
                        onClick={() => onDelete(item.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {createForm("personal") ?? (
          <div className="dash-boards-create">
            <button type="button" data-testid="dash-new-board" disabled={saving || editing} onClick={() => startCreate("personal")}>
              + New board
            </button>
          </div>
        )}
      </section>

      <section className="dash-boards-group">
        <p>Team</p>
        {orgBoards.length === 0 ? (
          <p className="dash-library-empty">
            {canShareOrg
              ? "No team boards yet. A team board is a Home everyone on the team can open."
              : "No team boards published yet."}
          </p>
        ) : (
          <ul className="dash-boards-list">
            {orgBoards.map((item) => (
              <li key={item.id} data-active={board?.id === item.id ? "true" : "false"}>
                {renameId === item.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRename(item.id, renameDraft);
                    }}
                  >
                    <input
                      value={renameDraft}
                      onChange={(event) => onRenameDraft(event.target.value)}
                      maxLength={80}
                      autoFocus
                      aria-label="Board name"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="dash-board-pick"
                    disabled={saving || editing}
                    onClick={() => onSwitch(item.id)}
                  >
                    <strong>{item.name}</strong>
                    <span>{board?.id === item.id ? "Showing now" : "Shared · tap to open"}</span>
                  </button>
                )}
                <div className="dash-boards-actions">
                  {canShareOrg ? (
                    renameId === item.id ? (
                      <>
                        <button type="button" disabled={saving} onClick={() => onRename(item.id, renameDraft)}>
                          Save
                        </button>
                        <button type="button" disabled={saving} onClick={onCancelRename}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={saving} onClick={() => onStartRename(item.id, item.name)}>
                          Rename
                        </button>
                        <button
                          type="button"
                          data-testid="dash-duplicate-board"
                          disabled={saving || editing}
                          onClick={() => onDuplicate(item.id)}
                        >
                          Copy to mine
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={saving}
                          aria-label={`Delete ${item.name}`}
                          onClick={() => onDelete(item.id)}
                        >
                          Delete
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <button type="button" disabled={saving || editing} onClick={() => onSwitch(item.id)}>
                        Open
                      </button>
                      <button
                        type="button"
                        data-testid="dash-duplicate-board"
                        disabled={saving || editing}
                        onClick={() => onDuplicate(item.id)}
                      >
                        Copy to mine
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canShareOrg
          ? createForm("org") ?? (
              <div className="dash-boards-create">
                <button type="button" disabled={saving || editing} onClick={() => startCreate("org")}>
                  + New team board
                </button>
              </div>
            )
          : null}
      </section>
    </Modal>
  );
}
