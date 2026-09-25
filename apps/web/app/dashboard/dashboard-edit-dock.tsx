"use client";

import { useEffect, useRef, useState } from "react";

/*
  One toolbar for edit mode. There used to be two: a header strip inside the
  palette (Snap & tidy, Widget library, Done) and a floating dock (Cancel,
  Reset, Snap & tidy, + Widgets, Preview, Done, Save for team) that wrapped to
  two lines — so the same actions appeared twice and "Reset", which threw away
  your layout, sat right next to "Cancel".

  Now the three things you do every time are buttons — Cancel on the left,
  "+ Add widget" in the middle, Done on the right — with Undo beside Cancel,
  and everything occasional lives behind "•••".
*/
export function DashboardEditDock({
  saving,
  libraryOpen,
  canShareOrg,
  canUndo,
  canRedo,
  onCancel,
  onUndo,
  onRedo,
  onToggleLibrary,
  onTidy,
  onPreview,
  onReset,
  onSaveOrg,
  onDone,
}: {
  saving: boolean;
  libraryOpen: boolean;
  canShareOrg: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLibrary: () => void;
  onTidy: () => void;
  onPreview: () => void;
  onReset: () => void;
  onSaveOrg: () => void;
  onDone: () => void;
}) {
  return (
    <div className="dash-editbar" role="toolbar" aria-label="Edit Home" data-testid="dash-edit-toolbar">
      <div className="dash-editbar-side">
        <button className="dash-editbar-btn" type="button" data-testid="dash-edit-cancel" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="dash-editbar-btn dash-editbar-icon"
          type="button"
          data-testid="dash-undo"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={saving || !canUndo}
          onClick={onUndo}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <button
        className="dash-editbar-add"
        type="button"
        data-testid="dash-open-library"
        aria-expanded={libraryOpen}
        aria-controls="dash-widget-sheet"
        disabled={saving}
        onClick={onToggleLibrary}
      >
        <span aria-hidden="true">+</span> Add widget
      </button>
      <div className="dash-editbar-side dash-editbar-end">
        <DashboardEditMenu
          saving={saving}
          canShareOrg={canShareOrg}
          canRedo={canRedo}
          onRedo={onRedo}
          onTidy={onTidy}
          onPreview={onPreview}
          onReset={onReset}
          onSaveOrg={onSaveOrg}
        />
        <button className="dash-editbar-done" type="button" data-testid="dash-edit-done" disabled={saving} onClick={onDone}>
          {saving ? "Saving…" : "Done"}
        </button>
      </div>
    </div>
  );
}

function DashboardEditMenu({
  saving,
  canShareOrg,
  canRedo,
  onRedo,
  onTidy,
  onPreview,
  onReset,
  onSaveOrg,
}: {
  saving: boolean;
  canShareOrg: boolean;
  canRedo: boolean;
  onRedo: () => void;
  onTidy: () => void;
  onPreview: () => void;
  onReset: () => void;
  onSaveOrg: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div
      className="dash-editbar-menu"
      ref={rootRef}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          // Handled here so the page's Escape (which cancels editing) does not also fire.
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <button
        ref={triggerRef}
        className="dash-editbar-btn dash-editbar-icon"
        type="button"
        data-testid="dash-edit-more"
        aria-label="More edit options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <div className="dash-editbar-popover" role="menu" aria-label="More edit options">
          <button type="button" role="menuitem" data-testid="dash-redo" disabled={saving || !canRedo} onClick={pick(onRedo)}>
            <strong>Redo</strong>
            <span>Put back what Undo took away (Ctrl+Shift+Z)</span>
          </button>
          <button type="button" role="menuitem" data-testid="dash-tidy" disabled={saving} onClick={pick(onTidy)}>
            <strong>Snap &amp; tidy</strong>
            <span>Pack every card up and left, the way Home shows them</span>
          </button>
          <button type="button" role="menuitem" data-testid="dash-preview" onClick={pick(onPreview)}>
            <strong>Preview</strong>
            <span>See Home without the edit controls</span>
          </button>
          {canShareOrg ? (
            <button type="button" role="menuitem" data-testid="dash-save-team" disabled={saving} onClick={pick(onSaveOrg)}>
              <strong>Save for team</strong>
              <span>Share this layout as the team board</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            data-testid="dash-reset-board"
            disabled={saving}
            onClick={pick(onReset)}
          >
            <strong>Reset to default…</strong>
            <span>Start again from the standard widgets</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardPreviewDock({
  saving,
  onBack,
  onSave,
}: {
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="dash-editbar dash-previewbar" role="toolbar" aria-label="Previewing unsaved changes">
      <button className="dash-editbar-btn" type="button" data-testid="dash-preview-back" onClick={onBack}>
        Back to edit
      </button>
      <span className="dash-previewbar-note">Previewing unsaved changes</span>
      <button
        className="dash-editbar-done"
        type="button"
        disabled={saving}
        data-testid="dash-preview-save"
        onClick={onSave}
      >
        {/* The same word as the edit bar's button: one action had two names. */}
        {saving ? "Saving…" : "Done"}
      </button>
    </div>
  );
}
