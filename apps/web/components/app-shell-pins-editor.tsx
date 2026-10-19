"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./icon";
import { useExitPresence } from "./ui/use-exit-presence";
import {
  PIN_LIMIT,
  defaultPinHrefs,
  movePin,
  pinDefinition,
  placePin,
  togglePin,
  type PinGroup,
} from "../lib/nav/pins";

const FOCUSABLE = 'a[href],button:not(:disabled):not([tabindex="-1"]),input:not(:disabled)';

/**
 * Pinned: the one editor for the pinned places (the sidebar's Pinned group on a computer, the top
 * of search on a phone). Opened by the pencil in the sidebar, Edit in search, or from
 * Account → Appearance.
 *
 * The pins are a list you reorder by dragging the handle, or with the arrow keys on it; the
 * minus removes one. Everything else is listed below by workspace with a plus to add it.
 * Cancel on the left, Done on the right; nothing is saved until Done.
 */
export function AppShellPinsEditor({
  open,
  pins,
  catalog,
  allowed,
  onCancel,
  onSave,
}: {
  open: boolean;
  /** The saved pins (hrefs, in order). The draft starts from these each time it opens. */
  pins: string[];
  /** Places this person may pin, grouped by workspace. */
  catalog: PinGroup[];
  allowed: (href: string) => boolean;
  onCancel: () => void;
  /** Saves the draft; resolves to an error message, or null when it was saved. */
  onSave: (draft: string[]) => Promise<string | null>;
}) {
  const presence = useExitPresence(open, 200);
  const [draft, setDraft] = useState<string[]>(pins);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Each opening starts from what is saved, with focus on Cancel (the safe first control).
  useEffect(() => {
    if (!open) return;
    setDraft(pins);
    setMessage("");
    setAnnouncement("");
    setSaving(false);
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const frame = requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLElement>(".pins-editor-head button")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const opener = openerRef.current;
      openerRef.current = null;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body && !sheetRef.current?.contains(document.activeElement)) return;
        // Opened from the menu (now closed): back to the control that opens the menu or search.
        const visible = (node: HTMLElement | null | undefined) => Boolean(node?.isConnected && node.getClientRects().length > 0);
        const fallback = [...document.querySelectorAll<HTMLElement>(".soft-menu-btn, .app-sidebar-edit, .app-topbar-search")].find(visible);
        (visible(opener) ? opener : fallback)?.focus();
      });
    };
    // Only on opening: a late `pins` update must not wipe a draft being edited.
  }, [open]);

  const labelFor = (href: string) => pinDefinition(href)?.label ?? href;
  const dirty = draft.join("|") !== pins.join("|");
  const isDefault = draft.join("|") === defaultPinHrefs().join("|");
  const full = draft.length >= PIN_LIMIT;
  const groups = useMemo(() => catalog.filter((group) => group.items.length > 0), [catalog]);

  if (!presence.present) return null;

  function toggle(href: string) {
    const result = togglePin(draft, href);
    setDraft(result.pins);
    setMessage(result.error ?? "");
    if (!result.error) {
      const added = result.pins.length > draft.length;
      setAnnouncement(added ? `${labelFor(href)} pinned, ${result.pins.length} of ${PIN_LIMIT}.` : `${labelFor(href)} removed.`);
    }
  }

  function remove(href: string, index: number) {
    toggle(href);
    // The row is about to disappear: keep focus in the list, on the row that takes its place.
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(".pins-editor-remove");
      const next = rows?.[Math.min(index, (rows?.length ?? 1) - 1)];
      (next ?? sheetRef.current?.querySelector<HTMLElement>(".pins-editor-head button"))?.focus();
    });
  }

  function move(href: string, delta: number) {
    const next = movePin(draft, href, delta);
    if (next.join("|") === draft.join("|")) return;
    setDraft(next);
    setAnnouncement(`${labelFor(href)} moved to place ${next.indexOf(href) + 1} of ${next.length}.`);
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, href: string) {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : event.key === "Home" ? -PIN_LIMIT : event.key === "End" ? PIN_LIMIT : 0;
    if (!delta) return;
    event.preventDefault();
    move(href, delta);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-pin-handle="${CSS.escape(href)}"]`)?.focus());
  }

  /** Drag by the handle: the row follows the pointer's row slot, and lands where you let go. */
  function onHandlePointerDown(event: PointerEvent<HTMLButtonElement>, href: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(href);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLButtonElement>, href: string) {
    if (dragging !== href || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>("li[data-pin]")];
    const from = draft.indexOf(href);
    // The first row whose middle is below the pointer is where the dragged row goes. Rows
    // below the dragged one count it, so the slot is one less there.
    const above = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    const target = above < 0 ? rows.length - 1 : above > from ? above - 1 : above;
    if (target !== from) setDraft((current) => placePin(current, href, target));
  }

  function onHandlePointerUp(href: string) {
    if (dragging !== href) return;
    setDragging(null);
    setAnnouncement(`${labelFor(href)} moved to place ${draft.indexOf(href) + 1} of ${draft.length}.`);
  }

  async function done() {
    if (saving) return;
    if (!dirty) {
      onCancel();
      return;
    }
    setSaving(true);
    setMessage("");
    const error = await onSave(draft);
    setSaving(false);
    if (error) setMessage(error);
  }

  function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((node) => node.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="pins-editor" data-closing={presence.closing || undefined} inert={presence.closing}>
      <button className="pins-editor-scrim" type="button" tabIndex={-1} aria-label="Cancel editing your apps" onClick={onCancel} />
      <div
        ref={sheetRef}
        className="pins-editor-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pins-editor-title"
        aria-describedby="pins-editor-about"
        onKeyDown={keepFocusInside}
      >
        <header className="pins-editor-head">
          <button type="button" className="pins-editor-cancel" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <h2 id="pins-editor-title">Pinned</h2>
          <button type="button" className="pins-editor-done" onClick={() => void done()} disabled={saving}>
            {saving ? "Saving…" : "Done"}
          </button>
        </header>
        <div className="pins-editor-body">
          <p id="pins-editor-about" className="pins-editor-about">
            Pin up to {PIN_LIMIT} tools as shortcuts. They show in the sidebar on a computer and at the top of
            search on your phone. Every tool stays in its place either way.
          </p>

          <section aria-labelledby="pins-editor-pinned">
            <div className="pins-editor-section-head">
              <h3 id="pins-editor-pinned">Pinned</h3>
              <span>{draft.length} of {PIN_LIMIT}</span>
            </div>
            <p id="pins-editor-drag-help" className="pins-editor-sr">
              Drag the handle, or focus it and press the up and down arrow keys, to change the order.
            </p>
            <ol ref={listRef} className="pins-editor-list" data-dragging={dragging ? "true" : undefined}>
              {draft.map((href, index) => {
                const pin = pinDefinition(href);
                const label = pin?.label ?? href;
                const usable = allowed(href);
                return (
                  <li
                    key={href}
                    data-pin={href}
                    data-dragging={dragging === href || undefined}
                  >
                    <button
                      type="button"
                      className="pins-editor-remove"
                      aria-label={`Remove ${label}`}
                      disabled={saving}
                      onClick={() => remove(href, index)}
                    >
                      <Icon name="minus" />
                    </button>
                    <i className="pins-editor-symbol"><Icon name={pin?.icon ?? "grid"} /></i>
                    <span className="pins-editor-label">
                      <strong>{label}</strong>
                      {!usable ? <small>Not on this team. Remove it, or keep it for another team.</small> : null}
                    </span>
                    <button
                      type="button"
                      className="pins-editor-handle"
                      data-pin-handle={href}
                      aria-label={`Move ${label}, place ${index + 1} of ${draft.length}`}
                      aria-describedby="pins-editor-drag-help"
                      disabled={saving || draft.length < 2}
                      onKeyDown={(event) => onHandleKey(event, href)}
                      onPointerDown={(event) => onHandlePointerDown(event, href)}
                      onPointerMove={(event) => onHandlePointerMove(event, href)}
                      onPointerUp={() => onHandlePointerUp(href)}
                      onPointerCancel={() => onHandlePointerUp(href)}
                    >
                      <Icon name="grip" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="pins-editor-live" role="status" aria-live="polite">{announcement}</p>
            {message ? <p className="pins-editor-error" role="alert">{message}</p> : null}
          </section>

          <section aria-labelledby="pins-editor-add" className="pins-editor-add">
            <div className="pins-editor-section-head">
              <h3 id="pins-editor-add">Add apps</h3>
              {full ? <span>Remove one to add another</span> : null}
            </div>
            {groups.map((group) => (
              <div className="pins-editor-group" key={group.id} role="group" aria-labelledby={`pins-editor-group-${group.id}`}>
                <h4 id={`pins-editor-group-${group.id}`}>{group.label}</h4>
                <ul>
                  {group.items.map((item) => {
                    const pinned = draft.includes(item.href);
                    return (
                      <li key={item.href}>
                        <i className="pins-editor-symbol"><Icon name={item.icon} /></i>
                        <span className="pins-editor-label"><strong>{item.label}</strong></span>
                        <button
                          type="button"
                          className="pins-editor-add-btn"
                          aria-pressed={pinned}
                          aria-label={pinned ? `${item.label}, pinned. Remove` : `Pin ${item.label}`}
                          disabled={saving || (!pinned && full)}
                          onClick={() => toggle(item.href)}
                        >
                          <Icon name={pinned ? "check" : "plus"} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <div className="pins-editor-reset">
            <button
              type="button"
              disabled={saving || isDefault}
              onClick={() => {
                setDraft(defaultPinHrefs());
                setMessage("");
                setAnnouncement("Back to the default apps. Press Done to keep them.");
              }}
            >
              Reset to default
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
