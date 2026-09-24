"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

/*
  Which board you are looking at, and the way to the others, in one chip
  beside the greeting ("My dashboard ▾"). Boards used to be hard to find: with
  one board the only way in was More → Your boards, and a second board brought
  in a separate tab strip ("Match day | My dashboard | + | Your boards") that
  pushed Home down. The chip is there with one board or ten.
*/
export function DashboardBoardSwitcher({
  boards,
  board,
  saving,
  disabled,
  onSwitch,
  onNew,
  onManage,
}: {
  boards: BoardMeta[];
  board: BoardState | null;
  saving: boolean;
  /** While editing, the board you are editing stays put. */
  disabled: boolean;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = board?.isDefault || !board ? "My Home" : board.name;
  const activeId = board?.isDefault ? null : board?.id ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    // querySelector("A, B") returns the first match in page order, not the first selector
    // that matches, so look for the current board first.
    const root = rootRef.current;
    (
      root?.querySelector<HTMLButtonElement>("[role^=menuitem][aria-checked='true']:not(:disabled)") ??
      root?.querySelector<HTMLButtonElement>("[role^=menuitem]:not(:disabled)")
    )?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div
      className="dash-board-chip-wrap"
      ref={rootRef}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? []);
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="dash-board-chip"
        data-testid="dash-board-chip"
        data-scope={board?.scope ?? "personal"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Board: ${current}. Switch or manage boards`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {board?.scope === "org" && !board.isDefault ? <em>Team</em> : null}
        <span>{current}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="dash-board-menu" role="menu" aria-label="Boards" data-testid="dash-board-menu">
          {boards.length === 0 ? (
            <button type="button" role="menuitemradio" aria-checked="true" onClick={pick(() => undefined)}>
              <span>{current}</span>
            </button>
          ) : (
            boards.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === activeId}
                disabled={saving}
                onClick={pick(() => {
                  if (item.id !== activeId) onSwitch(item.id);
                })}
              >
                <span>{item.name}</span>
                {item.scope === "org" ? <em>Team</em> : null}
              </button>
            ))
          )}
          <hr />
          <button type="button" role="menuitem" data-testid="dash-new-board" disabled={saving} onClick={pick(onNew)}>
            <span>New board…</span>
          </button>
          <button type="button" role="menuitem" data-testid="dash-manage-boards" disabled={saving} onClick={pick(onManage)}>
            <span>Manage boards</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
