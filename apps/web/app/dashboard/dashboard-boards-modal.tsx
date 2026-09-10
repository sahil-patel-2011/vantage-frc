"use client";

import { Modal } from "../../components/ui";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

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
  onCreatePersonal: () => void;
  onCreateOrg: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Home Screens"
      description="Personal boards are yours. Team boards are shared — owner/admin can create and edit them."
      variant="sheet"
    >
      <section className="dash-boards-group">
        <p>Personal</p>
        {personalBoards.length === 0 ? (
          <p className="dash-library-empty">No saved personal boards yet — create one to keep a custom layout.</p>
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
                    <span>{board?.id === item.id ? "Current" : "Personal"} · tap to open</span>
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
                      <button type="button" className="danger" disabled={saving} onClick={() => onDelete(item.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="dash-boards-create">
          <button type="button" disabled={saving || editing} onClick={onCreatePersonal}>
            + New personal board
          </button>
        </div>
      </section>

      <section className="dash-boards-group">
        <p>Team</p>
        {orgBoards.length === 0 ? (
          <p className="dash-library-empty">
            {canShareOrg
              ? "No team boards yet — create a shared Home Screen for the whole org."
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
                    <span>{board?.id === item.id ? "Current" : "Shared"} · tap to open</span>
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
                        <button type="button" className="danger" disabled={saving} onClick={() => onDelete(item.id)}>
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
        {canShareOrg ? (
          <div className="dash-boards-create">
            <button type="button" disabled={saving || editing} onClick={onCreateOrg}>
              + New team board
            </button>
          </div>
        ) : null}
      </section>
    </Modal>
  );
}
