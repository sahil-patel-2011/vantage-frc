"use client";

import { useState } from "react";
import { Button, Panel } from "../../components/ui";
import {
  lookupNoteEmptyCopy,
  type LookupNote,
} from "../../lib/intel/lookup-notes";

export function IntelLookupNotes({
  note,
  busy,
  onSave,
}: {
  note: LookupNote;
  busy?: boolean;
  onSave: (body: string) => void;
}) {
  const [draft, setDraft] = useState(note.body);
  const empty = lookupNoteEmptyCopy(note.canEdit);

  return (
    <Panel className="intel-lookup-notes motion-card" style={{ minHeight: "auto" }}>
      <header>
        <h3>Lead note</h3>
        <p className="app-muted">What drive team should remember about this robot.</p>
      </header>
      {note.canEdit ? (
        <form
          className="intel-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
          }}
        >
          <textarea
            value={draft}
            rows={4}
            maxLength={2000}
            placeholder={empty.detail}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="intel-note-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save note"}
            </Button>
            {note.updatedAt ? <small className="app-muted">Saved</small> : null}
          </div>
        </form>
      ) : note.body ? (
        <p className="intel-note-body">{note.body}</p>
      ) : (
        <p className="app-muted">{empty.detail}</p>
      )}
    </Panel>
  );
}
