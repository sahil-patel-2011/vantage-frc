"use client";

import dynamic from "next/dynamic";
import { ConfirmDialog, type ConfirmOpts } from "../../components/ui/confirm-dialog";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

const DashboardBoardsModal = dynamic(
  () => import("./dashboard-boards-modal").then((mod) => mod.DashboardBoardsModal),
  { ssr: false },
);
const DashboardNewBoardDialog = dynamic(
  () => import("./dashboard-new-board-dialog").then((mod) => mod.DashboardNewBoardDialog),
  { ssr: false },
);

export type HomeConfirm =
  | { kind: "discard" }
  | { kind: "leave"; href: string }
  | { kind: "reset" }
  | { kind: "team" }
  | { kind: "delete"; id: string; name: string };

function confirmOpts(confirm: HomeConfirm | null, board: BoardState | null): ConfirmOpts | null {
  if (!confirm) return null;
  switch (confirm.kind) {
    case "reset":
      return {
        title: "Reset this board?",
        body: "Your cards go back to the standard set for your role. Nothing is saved until you tap Done, and Undo brings your layout back.",
        confirmLabel: "Reset board",
        cancelLabel: "Keep my layout",
      };
    case "team":
      return board?.scope === "org" && board.id
        ? {
            title: `Update ${board.name} for the team?`,
            body: "Everyone who uses this team board will see this layout.",
            confirmLabel: "Save for team",
            cancelLabel: "Keep editing",
            tone: "neutral",
          }
        : {
            title: "Share this layout as a team board?",
            body: "Everyone on the team can switch to it from their boards. Your own Home stays as it is, and you stay on it.",
            confirmLabel: "Share with team",
            cancelLabel: "Keep editing",
            tone: "neutral",
          };
    case "leave":
      return {
        title: "Leave without saving?",
        body: "You changed this board since tapping Edit. Leaving now drops those changes; Done saves them.",
        confirmLabel: "Leave without saving",
        cancelLabel: "Keep editing",
      };
    case "discard":
      return {
        title: "Discard changes?",
        body: "The changes you made to this board since tapping Edit will be lost.",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
      };
    case "delete":
      return {
        title: `Delete “${confirm.name}”?`,
        body: "This board and its layout are deleted for good. Your other boards and the cards' data are not touched.",
        confirmLabel: `Delete ${confirm.name}`,
        cancelLabel: "Keep it",
      };
  }
}

/**
 * Every dialog Home opens: the in-app confirm (discard, reset, share, delete a
 * board), the board manager, and the small "New board" step. Deleting a board
 * used the browser's own confirm box, unlike every other question on the page.
 * The manager steps aside while its delete question is up — two dialogs open at
 * once fought over the keyboard — and comes back after.
 */
export function DashboardHomeDialogs({
  confirm,
  onConfirm,
  board,
  boardsOpen,
  newBoardOpen,
  personalBoards,
  orgBoards,
  saving,
  editing,
  canShareOrg,
  renameId,
  renameDraft,
  onCloseBoards,
  onCloseNewBoard,
  onRenameDraft,
  onSwitch,
  onRename,
  onDuplicate,
  onRequestDelete,
  onStartRename,
  onCancelRename,
  onCreatePersonal,
  onCreateOrg,
}: {
  confirm: HomeConfirm | null;
  onConfirm: (confirm: HomeConfirm, ok: boolean) => void;
  board: BoardState | null;
  boardsOpen: boolean;
  newBoardOpen: boolean;
  personalBoards: BoardMeta[];
  orgBoards: BoardMeta[];
  saving: boolean;
  editing: boolean;
  canShareOrg: boolean;
  renameId: string | null;
  renameDraft: string;
  onCloseBoards: () => void;
  onCloseNewBoard: () => void;
  onRenameDraft: (value: string) => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onCreatePersonal: (name: string) => void;
  onCreateOrg: (name: string) => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={confirm !== null}
        opts={confirmOpts(confirm, board)}
        onResolve={(ok) => {
          if (confirm) onConfirm(confirm, ok);
        }}
      />
      {boardsOpen ? (
        <DashboardBoardsModal
          open
          onClose={onCloseBoards}
          board={board}
          personalBoards={personalBoards}
          orgBoards={orgBoards}
          saving={saving}
          editing={editing}
          canShareOrg={canShareOrg}
          renameId={renameId}
          renameDraft={renameDraft}
          onRenameDraft={onRenameDraft}
          onSwitch={onSwitch}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onRequestDelete}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
          onCreatePersonal={onCreatePersonal}
          onCreateOrg={onCreateOrg}
        />
      ) : null}
      {newBoardOpen ? (
        <DashboardNewBoardDialog
          open
          existingNames={[...personalBoards, ...orgBoards].map((item) => item.name)}
          saving={saving}
          onClose={onCloseNewBoard}
          onCreate={(name) => {
            onCloseNewBoard();
            onCreatePersonal(name);
          }}
        />
      ) : null}
    </>
  );
}
