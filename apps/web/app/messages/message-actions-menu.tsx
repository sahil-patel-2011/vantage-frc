"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { withOrgHref } from "../../lib/nav/product-nav";
import { MoreIcon } from "./chat-icons";
import { MessageModerationActions, type ModerationMode } from "./message-moderation-actions";

type Props = {
  orgId: string;
  messageId: string;
  authorLabel: string;
  mine: boolean;
  /** Pin / Unpin only exists in team channels, and only once the pins migration is in. */
  canPin: boolean;
  pinned: boolean;
  /** Owner/admin — the same role check the server makes again. */
  canModerate: boolean;
  onTogglePin: () => void;
  onDelete: () => void;
  /** Re-read the thread after a removal. */
  onChanged: () => void;
};

type Item =
  | { key: string; label: string; tone?: "danger"; onSelect: () => void }
  | { key: string; label: string; href: string };

/**
 * One "…" button per message instead of a row of Pin note / Report / Remove / Moderation on every
 * message. The row repeated four buttons down the whole thread and, on a phone, wrapped into a
 * stack taller than the message it belonged to.
 *
 * Follows the WAI-ARIA menu button pattern: Enter, Space or ArrowDown opens it on the first item,
 * ArrowUp opens it on the last, arrows / Home / End move, Escape closes and returns focus to the
 * button, Tab closes and moves on.
 */
export function MessageActionsMenu({
  orgId,
  messageId,
  authorLabel,
  mine,
  canPin,
  pinned,
  canModerate,
  onTogglePin,
  onDelete,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  // Opens upward when the message sits low on screen, so the menu is not hidden behind the
  // message box pinned to the bottom of the conversation.
  const [upward, setUpward] = useState(false);
  const [mode, setMode] = useState<ModerationMode>("idle");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  // Which item takes focus once the menu has rendered; set by whatever opened it.
  const pendingFocusRef = useRef<number | null>(null);
  const menuId = useId();

  const items: Item[] = [];
  if (canPin) {
    items.push({ key: "pin", label: pinned ? "Unpin" : "Pin note", onSelect: onTogglePin });
  }
  if (mine) {
    items.push({ key: "delete", label: "Delete", tone: "danger", onSelect: onDelete });
  } else {
    items.push({ key: "report", label: "Report", onSelect: () => setMode("report") });
    if (canModerate) {
      items.push({ key: "remove", label: "Remove", tone: "danger", onSelect: () => setMode("remove") });
    }
  }
  if (canModerate) {
    items.push({ key: "moderation", label: "Moderation", href: withOrgHref("/messages/moderation", orgId) });
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || pendingFocusRef.current === null) return;
    itemRefs.current[pendingFocusRef.current]?.focus();
    pendingFocusRef.current = null;
  }, [open]);

  function focusItem(index: number) {
    const count = items.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    itemRefs.current[next]?.focus();
  }

  function openMenu(focusIndex: number) {
    const rect = buttonRef.current?.getBoundingClientRect();
    setUpward(rect ? rect.bottom > window.innerHeight * 0.55 : false);
    pendingFocusRef.current = Math.max(0, Math.min(focusIndex, items.length - 1));
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((node) => node === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(items.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <div className="message-menu" ref={wrapRef}>
        <button
          ref={buttonRef}
          type="button"
          className="message-menu-trigger"
          aria-label={`Message actions, ${authorLabel}`}
          title="Message actions"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? closeMenu(false) : openMenu(0))}
          onKeyDown={onButtonKeyDown}
        >
          <MoreIcon />
        </button>
        {open ? (
          <div
            id={menuId}
            role="menu"
            aria-label="Message actions"
            className={`message-menu-list${upward ? " is-upward" : ""}`}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item, index) =>
              "href" in item ? (
                <a
                  key={item.key}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  href={item.href}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.key}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={item.tone === "danger" ? "is-danger" : undefined}
                  onClick={() => {
                    // Focus goes back to the "…" button unless the item opens a form, which
                    // takes focus itself.
                    closeMenu(item.key !== "report" && item.key !== "remove");
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
      {/* Report and Remove only exist for someone else's message. */}
      {!mine ? (
        <MessageModerationActions
          orgId={orgId}
          messageId={messageId}
          mode={mode}
          onModeChange={setMode}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}
