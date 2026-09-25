"use client";

import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import { suggestBoardName } from "../../lib/dashboard/edit-mode";

/**
 * "New board…": one small step — a name (Match day, already filled in and
 * selected) and a filled Create. It used to open the whole board manager, where
 * "Create board" looked exactly like "Cancel" and sat under a red Delete.
 */
export function DashboardNewBoardDialog({
  open,
  existingNames,
  saving,
  onCreate,
  onClose,
}: {
  open: boolean;
  existingNames: string[];
  saving: boolean;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => suggestBoardName(existingNames));
  return (
    <Modal open={open} onClose={onClose} title="New board" description="A board is its own arrangement of Home, just for you. It starts with the standard cards for your role; change them after." className="dash-new-board-dialog">
      <form
        className="dash-new-board"
        data-testid="dash-new-board-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          onCreate(trimmed);
        }}
      >
        <label>
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            data-testid="dash-new-board-name"
          />
        </label>
        <div className="dash-new-board-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()} data-testid="dash-new-board-create">
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
