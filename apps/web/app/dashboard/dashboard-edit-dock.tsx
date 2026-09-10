"use client";

export function DashboardEditDock({
  saving,
  libraryOpen,
  canShareOrg,
  onCancel,
  onReset,
  onTidy,
  onToggleLibrary,
  onPreview,
  onSavePersonal,
  onSaveOrg,
}: {
  saving: boolean;
  libraryOpen: boolean;
  canShareOrg: boolean;
  onCancel: () => void;
  onReset: () => void;
  onTidy: () => void;
  onToggleLibrary: () => void;
  onPreview: () => void;
  onSavePersonal: () => void;
  onSaveOrg: () => void;
}) {
  return (
    <div className="dash-edit-dock" role="toolbar" aria-label="Home Screen edit actions">
      <button className="dash-dock-ghost" type="button" disabled={saving} onClick={onCancel}>
        Cancel
      </button>
      <button className="dash-dock-ghost" type="button" disabled={saving} onClick={onReset}>
        Reset
      </button>
      <button className="dash-dock-ghost dash-dock-tidy" type="button" disabled={saving} onClick={onTidy}>
        <span aria-hidden="true">⌗</span> Snap &amp; tidy
      </button>
      <button
        className="dash-dock-add"
        type="button"
        data-testid="dash-open-library"
        aria-pressed={libraryOpen}
        onClick={onToggleLibrary}
      >
        <span aria-hidden="true">+</span>
        Widgets
      </button>
      <button className="dash-dock-ghost" type="button" data-testid="dash-preview" onClick={onPreview}>
        Preview
      </button>
      <button className="dash-dock-done" type="button" disabled={saving} onClick={onSavePersonal}>
        {saving ? "Saving…" : "Done"}
      </button>
      {canShareOrg ? (
        <button className="dash-dock-team" type="button" disabled={saving} onClick={onSaveOrg}>
          Save for team
        </button>
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
    <div className="dash-edit-dock dash-preview-dock" role="status" aria-label="Previewing unsaved home changes">
      <span>Previewing unsaved changes</span>
      <button className="dash-dock-ghost" type="button" data-testid="dash-preview-back" onClick={onBack}>
        Back to edit
      </button>
      <button
        className="dash-dock-done"
        type="button"
        disabled={saving}
        data-testid="dash-preview-save"
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
