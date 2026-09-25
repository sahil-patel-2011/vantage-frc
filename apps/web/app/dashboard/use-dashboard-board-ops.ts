"use client";

import {
  useEffect,
  useRef,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  dropWidgetOntoLayout,
  duplicateBoardName,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import { applyOrder, describePlace, nudgeOrder, readingOrder } from "../../lib/dashboard/board-order";
import {
  DASHBOARD_COLUMNS,
  WIDGET_SIZE_LABEL,
  applyWidgetSize,
  catalogEntry,
  defaultDashboardLayoutForAudience,
  layoutOrAudienceDefault,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import { moveItem, type GridCell, type NudgeDirection } from "../../lib/dashboard/grid-drag";
import { boardHasGap, layoutsEqual, setAlwaysShow, tidyBoard } from "../../lib/dashboard/edit-mode";
import { ARROW_DIRECTION } from "./dashboard-canvas";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

type LoadSnapshot = (
  id: string,
  types?: DashboardWidgetType[],
  opts?: { fullContext?: boolean; signal?: AbortSignal },
) => Promise<void>;

/**
 * Save / add / resize / keyboard reorder for Home. The client keeps poll,
 * measurement, and the painted grid; this hook owns the mutations those
 * controls fire.
 */
export function useDashboardBoardOps(input: {
  orgId: string;
  userId: string;
  board: BoardState | null;
  boards: BoardMeta[];
  layout: DashboardWidgetLayout[];
  layoutRef: MutableRefObject<DashboardWidgetLayout[]>;
  displayLayout: DashboardWidgetLayout[];
  cols: number;
  canShareOrg: boolean;
  saving: boolean;
  editing: boolean;
  grabbedId: string | null;
  /** The board as painted for a given saved layout — what Snap & tidy judges. */
  displayFor: (layout: DashboardWidgetLayout[]) => DashboardWidgetLayout[];
  /**
   * The draft laid out like Home: shown cards packed, hidden ones below them.
   * Every add, resize and remove settles through it, so a card Home is hiding
   * never sits in a hole on the edit board.
   */
  settle: (layout: DashboardWidgetLayout[]) => DashboardWidgetLayout[];
  previewing: boolean;
  resetAudience: "mentor" | "student";
  loadHome: (id: string, preferredBoardId?: string | null) => Promise<void>;
  loadSnapshot: LoadSnapshot;
  /** Remember the layout a change is about to replace, for Undo. */
  record: (snapshot: DashboardWidgetLayout[]) => void;
  grabBaseRef: MutableRefObject<DashboardWidgetLayout[] | null>;
  setLayout: Dispatch<SetStateAction<DashboardWidgetLayout[]>>;
  setBoard: Dispatch<SetStateAction<BoardState | null>>;
  setBoards: Dispatch<SetStateAction<BoardMeta[]>>;
  setScope: Dispatch<SetStateAction<"personal" | "org">>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setMessageKind: Dispatch<SetStateAction<"success" | "error">>;
  setMessageAction: Dispatch<SetStateAction<"undo" | null>>;
  setHighlightId: Dispatch<SetStateAction<string | null>>;
  setAnnounce: Dispatch<SetStateAction<string>>;
  setGrabbedId: Dispatch<SetStateAction<string | null>>;
  setEditing: Dispatch<SetStateAction<boolean>>;
  setPreviewing: Dispatch<SetStateAction<boolean>>;
  setLibraryOpen: Dispatch<SetStateAction<boolean>>;
  /** A card was added in this edit, so it stays on the board while editing. */
  onWidgetAdded?: (id: string) => void;
  /** What the loaded data says about a widget type right now ("live", "empty", …). */
  widgetStatus?: (type: DashboardWidgetType) => string | undefined;
  setBoardsOpen: Dispatch<SetStateAction<boolean>>;
  setRenameId: Dispatch<SetStateAction<string | null>>;
  setRenameDraft: Dispatch<SetStateAction<string>>;
}) {
  const {
    orgId,
    userId,
    board,
    boards,
    layout,
    layoutRef,
    displayLayout,
    cols,
    canShareOrg,
    saving,
    editing,
    grabbedId,
    displayFor,
    settle,
    previewing,
    resetAudience,
    loadHome,
    loadSnapshot,
    record,
    grabBaseRef,
    setLayout,
    setBoard,
    setBoards,
    setScope,
    setSaving,
    setMessage,
    setMessageKind,
    setMessageAction,
    setHighlightId,
    setAnnounce,
    setGrabbedId,
    setEditing,
    setPreviewing,
    setLibraryOpen,
    onWidgetAdded,
    widgetStatus,
    setBoardsOpen,
    setRenameId,
    setRenameDraft,
  } = input;

  function addWidget(type: DashboardWidgetType, drop?: GridCell, displayCols?: number) {
    const result = dropWidgetOntoLayout(layoutRef.current, type, {
      drop: drop ? { x: drop.col, y: drop.row } : undefined,
      displayCols: displayCols ?? DASHBOARD_COLUMNS,
      now: Date.now(),
    });
    if (!result.ok) {
      setMessageKind("error");
      setMessage(result.error);
      return;
    }
    const entry = catalogEntry(type);
    const added = result.layout[result.layout.length - 1];
    // A dropped card takes the cell it was dropped on (where the placeholder showed it); on a tie
    // the card already there used to go first and the new one landed below it.
    if (drop && added) {
      result.layout = moveItem(result.layout, added.i, { col: added.x, row: added.y }, DASHBOARD_COLUMNS, { bias: "before" });
    }
    /*
      A card with nothing in it yet is added with "Always show" on. Home hides
      empty cards, so a freshly added Batteries card vanished the moment you
      tapped Done and looked like a bug. Only a card already known to have data
      is left to hide itself when it empties.
    */
    const keepWhenEmpty = Boolean(added) && widgetStatus?.(type) !== "live";
    const nextLayout = keepWhenEmpty && added ? setAlwaysShow(result.layout, added.i, true) : result.layout;
    record(layoutRef.current);
    // Packed, not just pulled up: a card dropped beside a hole slides into it,
    // so the board never needs a separate tidy after an add.
    setLayout(settle(nextLayout));
    if (added) {
      onWidgetAdded?.(added.i);
      setHighlightId(added.i);
    }
    const label = entry?.label ?? type;
    setMessageKind("success");
    // Every add can be taken back from its own message, dragged in or tapped.
    setMessageAction("undo");
    setMessage(
      keepWhenEmpty
        ? `${label} added to the board. It stays on Home and fills in as your team uses it.`
        : `${label} added to the board.`,
    );
    setAnnounce(
      keepWhenEmpty
        ? `${label} added to the board, set to always show on Home even while it is empty.`
        : `${label} added to the board.`,
    );
    // On a laptop the library stays open for the next card, tapped or dragged (its row now says
    // it's on Home); adding three cards took three trips. On a phone the sheet covers the board,
    // so it closes to show the new card.
    if (typeof window === "undefined" || window.innerWidth < 720) setLibraryOpen(false);
    if (orgId) void loadSnapshot(orgId, result.layout.map((item) => item.type)).catch(() => {
      setMessageKind("error");
      setMessage("Widget added, but its data could not refresh. Try Refresh card data.");
    });
  }

  function tidyLayout() {
    const visibleIds = new Set(displayFor(layoutRef.current).map((item) => item.i));
    const result = tidyBoard({ layout: layoutRef.current, visibleIds, cols, displayFor });
    setMessageKind("success");
    setMessageAction(null);
    if (!result.moved) {
      // A gap can be left because every card after it is too wide to fit; say that, and
      // what closes it, instead of "Nothing to tidy" next to a visible hole.
      if (boardHasGap(displayFor(layoutRef.current), cols)) {
        setMessage("No card fits the gap. Make the card beside it wider, or a card below it smaller.");
        setAnnounce("No card fits the gap. Make the card beside it wider, or a card below it smaller.");
        return;
      }
      setMessage("Nothing to tidy.");
      setAnnounce("Nothing to tidy. Every card is already as far up and left as it fits.");
      return;
    }
    record(layoutRef.current);
    setLayout(result.layout);
    setMessageAction("undo");
    setMessage("Board tidied. Cards moved to fill the gaps.");
    setAnnounce("Board tidied. Cards moved to fill the gaps.");
  }

  /**
   * "Always show" from the hidden row under the board. The card goes back on
   * Home even while it is empty (or, for setup cards, after setup is done).
   * Part of the draft like any other edit: Undo reverts it, Done saves it.
   */
  function setAlwaysShown(id: string, always: boolean) {
    const target = layoutRef.current.find((item) => item.i === id);
    if (!target) return;
    const label = catalogEntry(target.type)?.label ?? target.type;
    record(layoutRef.current);
    setLayout(setAlwaysShow(layoutRef.current, id, always));
    if (always) setHighlightId(id);
    setMessageKind("success");
    setMessageAction("undo");
    setMessage(always ? `${label} will always show on Home.` : `${label} hides again when it has nothing to show.`);
    setAnnounce(always ? `${label} will always show on Home.` : `${label} hides again when it has nothing to show.`);
  }

  function setWidgetSize(id: string, size: WidgetSizeKey) {
    record(layoutRef.current);
    setLayout((current) => {
      const resized = current.map((item) => {
        if (item.i !== id) return item;
        return applyWidgetSize(item, size, catalogEntry(item.type));
      });
      return settle(resized);
    });
    const target = layoutRef.current.find((item) => item.i === id);
    const label = target ? catalogEntry(target.type)?.label ?? target.type : "Widget";
    setAnnounce(`${label} resized to ${WIDGET_SIZE_LABEL[size]}.`);
  }

  /** Back to the size the catalog ships this widget at — its designed shape. */
  function resetWidgetSize(id: string) {
    const target = layoutRef.current.find((item) => item.i === id);
    const entry = target ? catalogEntry(target.type) : undefined;
    if (!target || !entry) return;
    record(layoutRef.current);
    setLayout((current) => {
      const resized = current.map((item) =>
        item.i === id
          ? {
              ...item,
              w: entry.defaultW,
              h: entry.defaultH,
              minW: entry.minW,
              minH: entry.minH,
              x: Math.max(0, Math.min(DASHBOARD_COLUMNS - entry.defaultW, item.x)),
            }
          : item,
      );
      return settle(resized);
    });
    const label = entry.label ?? target.type;
    setAnnounce(`${label} reset to its default size.`);
  }

  // The double-click guard (the next card's "−" sliding under the pointer) is on the button
  // itself, in dashboard-grid-item.tsx, where the pointer position is known.
  function removeWidget(id: string) {
    const removed = layoutRef.current.find((item) => item.i === id);
    record(layoutRef.current);
    // Packed so the hole it leaves closes straight away.
    setLayout((current) => settle(current.filter((item) => item.i !== id)));
    const label = removed ? catalogEntry(removed.type)?.label ?? removed.type : "Widget";
    setMessageKind("success");
    setMessageAction("undo");
    setMessage(`${label} removed.`);
    setAnnounce(`${label} removed from the board.`);
    if (grabbedId === id) setGrabbedId(null);
  }

  async function save(activateScope: "personal" | "org" = "personal") {
    if (!orgId) {
      setMessageKind("error");
      setMessage("Choose your team to save a custom layout.");
      return;
    }
    if (activateScope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to save a shared Home for the team.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const keepId = board?.id && board.scope === activateScope ? board.id : null;
      const name =
        keepId && board?.name
          ? board.name
          : activateScope === "org"
            ? "Team board"
            : "My Home"; // the name the chip showed before the first save
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: keepId,
          name,
          scope: activateScope,
          layout,
          activate: true,
          action: "save",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Save failed");
        return;
      }
      // Edit mode ends only once the switch has happened; a failed switch leaves the member
      // in their draft instead of showing it as if it were saved.
      if (editing) {
        setEditing(false);
        setPreviewing(false);
        setLibraryOpen(false);
        setGrabbedId(null);
      }
      writeStoredBoardId(orgId, userId, data.id);
      setBoard({
        id: data.id,
        name: data.name,
        scope: data.scope,
        layout: data.layout,
      });
      setScope(data.scope);
      setLayout(data.layout);
      setEditing(false);
      setLibraryOpen(false);
      setGrabbedId(null);
      setPreviewing(false);
      // After the reload: loadHome clears the message when it succeeds.
      await loadHome(orgId, data.id);
      setMessageKind("success");
      setMessageAction(null);
      setMessage(data.scope === "org" ? "Saved as the team board." : "Home saved.");
    } catch {
      setMessageKind("error");
      setMessage("Could not save your layout. Your changes are still here; please try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * "Save for team", after the member has confirmed. Shares the draft as a
   * team board and leaves them where they were: on their own board, still
   * editing, with nothing of theirs saved or switched. It used to save and
   * switch Home to the team board in one tap. Returns the team board so the
   * toast can offer to open it.
   */
  async function shareWithTeam(): Promise<{ id: string; name: string } | null> {
    if (!orgId) return null;
    if (!canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to share a layout with the team.");
      return null;
    }
    const onTeamBoard = board?.scope === "org" && Boolean(board.id);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: onTeamBoard ? board?.id : null,
          name: onTeamBoard ? board?.name : "Team board",
          scope: "org",
          layout: layoutRef.current,
          // Only a team board you are already on stays active; sharing from
          // your own board must not switch your Home away from it.
          activate: onTeamBoard,
          action: "save",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not share this layout with the team.");
        return null;
      }
      setBoards((current) =>
        current.some((item) => item.id === data.id)
          ? current.map((item) => (item.id === data.id ? { ...item, name: data.name } : item))
          : [...current, { id: data.id, name: data.name, scope: "org", isActive: Boolean(data.isActive) }],
      );
      if (onTeamBoard) {
        // You are editing the team board itself, so this is its save.
        setBoard((current) => (current ? { ...current, layout: data.layout } : current));
        setLayout(data.layout);
        setEditing(false);
        setLibraryOpen(false);
        setGrabbedId(null);
        setPreviewing(false);
      }
      setMessageKind("success");
      setMessageAction(null);
      setMessage(
        onTeamBoard
          ? `Saved ${data.name} for the team.`
          : `Shared as “${data.name}”. You're still on your own board.`,
      );
      setAnnounce(onTeamBoard ? `Saved ${data.name} for the team.` : `Shared with the team as ${data.name}.`);
      return { id: data.id, name: data.name };
    } catch {
      setMessageKind("error");
      setMessage("Could not share this layout with the team. Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  /**
   * `leaveEditing` is for "Open team board" on the toast after sharing: the
   * team board already holds the draft, so edit mode ends and Home switches.
   */
  async function switchBoard(targetId: string, opts?: { leaveEditing?: boolean }) {
    if (!orgId || !targetId || targetId === board?.id || saving) return;
    if (editing && !opts?.leaveEditing) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId, action: "activate" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not switch boards");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setBoard({
        id: data.id,
        name: data.name,
        scope: data.scope,
        layout: data.layout,
      });
      setScope(data.scope);
      setLayout(layoutOrAudienceDefault(data.layout, resetAudience));
      setBoardsOpen(false);
      await loadHome(orgId, data.id);
      setMessageKind("success");
      setMessage(`Switched to ${data.name}`);
    } catch {
      setMessageKind("error");
      setMessage("Could not switch boards. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function createBoard(createScope: "personal" | "org", requestedName?: string) {
    if (!orgId) return;
    if (createScope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to create a shared Home for the team.");
      return;
    }
    const personalCount = boards.filter((item) => item.scope === "personal").length;
    const orgCount = boards.filter((item) => item.scope === "org").length;
    const label =
      requestedName?.trim().slice(0, 80) ||
      (createScope === "org" ? `Team board ${orgCount + 1}` : `Board ${personalCount + 1}`);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          name: label,
          scope: createScope,
          activate: true,
          action: "create",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not create board");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setEditing(true);
      setBoardsOpen(false);
      await loadHome(orgId, data.id);
      setMessageKind("success");
      setMessageAction(null);
      setMessage(`Created ${data.name}. Arrange it, then tap Done.`);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Copies any board the member can see into a new personal board. This is how a
   * student starts from the team layout without the risk of editing the shared
   * one — the server rejects the copy if they are already at the board cap.
   */
  async function duplicateBoard(targetId: string) {
    if (!orgId || !targetId || saving || editing) return;
    const source = boards.find((item) => item.id === targetId);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: targetId,
          name: source
            ? duplicateBoardName(
                source.name,
                boards.map((item) => item.name),
              )
            : undefined,
          scope: "personal",
          activate: true,
          action: "duplicate",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not duplicate board");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setRenameId(null);
      setBoardsOpen(false);
      await loadHome(orgId, data.id);
      setMessageKind("success");
      setMessage(`Duplicated to ${data.name}. It is yours to edit.`);
    } finally {
      setSaving(false);
    }
  }

  async function renameBoard(targetId: string, nextName: string) {
    if (!orgId || !targetId) return;
    const name = nextName.trim().slice(0, 80);
    if (!name) {
      setMessageKind("error");
      setMessage("Board name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId, name, action: "rename" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Rename failed");
        return;
      }
      setRenameId(null);
      setRenameDraft("");
      if (board?.id === targetId) setBoard((current) => (current ? { ...current, name: data.name } : current));
      setBoards((current) => current.map((item) => (item.id === targetId ? { ...item, name: data.name } : item)));
      setMessageKind("success");
      setMessage(`Renamed to ${data.name}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoard(targetId: string) {
    if (!orgId || !targetId) return;
    const target = boards.find((item) => item.id === targetId);
    if (!target) return;
    if (target.scope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to delete a shared Home.");
      return;
    }
    // The view asks first, in the app's own confirm dialog.
    setSaving(true);
    try {
      const response = await fetch("/api/dashboards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Delete failed");
        return;
      }
      if (board?.id === targetId) writeStoredBoardId(orgId, userId, data.activatedId ?? null);
      setRenameId(null);
      await loadHome(orgId, data.activatedId ?? null);
      setMessageKind("success");
      setMessage(`Deleted ${target.name}`);
    } finally {
      setSaving(false);
    }
  }

  /** The layout Done would replace — what Cancel goes back to. */
  function savedLayout() {
    return layoutOrAudienceDefault(board?.layout, resetAudience);
  }

  /*
    The draft as it stood when edit mode opened. Opening it lays the board out
    like Home (layoutForEditing), which can move cards Home is hiding; that is
    not a change you made, so it does not count as one.
  */
  const editBaselineRef = useRef<DashboardWidgetLayout[] | null>(null);
  useEffect(() => {
    if (!editing && !previewing) editBaselineRef.current = null;
  }, [editing, previewing]);

  function hasUnsavedChanges() {
    return !layoutsEqual(layoutRef.current, editBaselineRef.current ?? savedLayout());
  }

  function cancelEditing() {
    setLayout(savedLayout());
    setEditing(false);
    setPreviewing(false);
    setLibraryOpen(false);
    setGrabbedId(null);
    setHighlightId(null);
    setMessageAction(null);
    setMessage("");
  }

  /*
    No message on the way in. It used to post a paragraph of instructions at
    the top of the page — above the fold, while the board you were editing sat
    below it — so the one line above the board is the only instruction now.
  */
  function enterEditMode() {
    const start = settle(layoutRef.current);
    // Back from Preview keeps the baseline from when editing began.
    if (!editBaselineRef.current) editBaselineRef.current = start;
    setLayout(start);
    setEditing(true);
    setPreviewing(false);
    setLibraryOpen(false);
    setMessageAction(null);
    setMessage("");
  }

  /*
    Reset changes the draft, nothing else. It used to save the default layout
    to the server and leave edit mode in one tap, with no confirmation and no
    way back — people lost widgets they had spent a while arranging. Now it
    behaves like every other edit: Undo steps back over it, Cancel throws it
    away, and only Done saves it. The caller confirms first.

    The server's reset without a board id returns the member's default layout
    and writes nothing, so the draft gets the same default a real reset would.
  */
  async function resetDefault() {
    let nextLayout = defaultDashboardLayoutForAudience(resetAudience);
    if (orgId) {
      setSaving(true);
      try {
        const response = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action: "reset" }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          nextLayout = layoutOrAudienceDefault(Array.isArray(data.layout) ? data.layout : null, resetAudience);
        }
      } catch {
        // Offline: the built-in default for your role is still a real default.
      } finally {
        setSaving(false);
      }
    }
    record(layoutRef.current);
    setLayout(settle(nextLayout));
    setGrabbedId(null);
    setMessageKind("success");
    setMessageAction("undo");
    setMessage("Board reset to the default widgets. Tap Done to keep it.");
    setAnnounce("Board reset to the default widgets. Nothing is saved until you tap Done.");
    if (orgId) void loadSnapshot(orgId, nextLayout.map((item) => item.type)).catch(() => undefined);
  }

  function commitNudge(item: DashboardWidgetLayout, direction: NudgeDirection) {
    const label = catalogEntry(item.type)?.label ?? item.type;
    const order = nudgeOrder(displayLayout, item.i, direction);
    if (!order || order.join("|") === readingOrder(displayLayout).join("|")) {
      setAnnounce(`${label} is already ${direction === "up" || direction === "left" ? "first" : "last"} that way.`);
      return;
    }
    setLayout(applyOrder(layoutRef.current, order));
    setAnnounce(`${label} moved ${describePlace(displayLayout, order, item.i)}.`);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) {
    if (!editing) return;
    const label = catalogEntry(item.type)?.label ?? item.type;

    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault();
      if (grabbedId === item.i) {
        const base = grabBaseRef.current;
        if (base && !layoutsEqual(base, layoutRef.current)) record(base);
        setGrabbedId(null);
        grabBaseRef.current = null;
        setAnnounce(`${label} dropped.`);
      } else {
        setGrabbedId(item.i);
        grabBaseRef.current = layoutRef.current;
        setAnnounce(`${label} picked up. Arrow keys move it, space drops it, escape cancels.`);
      }
      return;
    }

    if (event.key === "Escape") {
      if (grabbedId !== item.i) return;
      event.preventDefault();
      if (grabBaseRef.current) setLayout(grabBaseRef.current);
      grabBaseRef.current = null;
      setGrabbedId(null);
      setAnnounce(`${label} move cancelled.`);
      return;
    }

    const direction = ARROW_DIRECTION[event.key];
    if (!direction || grabbedId !== item.i) return;
    event.preventDefault();
    commitNudge(item, direction);
  }

  return {
    addWidget,
    tidyLayout,
    setAlwaysShown,
    shareWithTeam,
    setWidgetSize,
    resetWidgetSize,
    removeWidget,
    save,
    switchBoard,
    createBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
    cancelEditing,
    enterEditMode,
    hasUnsavedChanges,
    resetDefault,
    onHandleKeyDown,
  };
}
