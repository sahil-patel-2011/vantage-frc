"use client";

import { useRef } from "react";
import { Button } from "../../../../../components/ui";
import type { PdfUploadProgress } from "./lesson-pdf-upload";

/**
 * The PDF of a PDF lesson, in place of the step list: open it, replace it, or go back to
 * writing steps. A PDF lesson is started from the list's "Upload a PDF" (the one way in), so a
 * written lesson's editor has no upload card of its own.
 */
export function PdfPanel({
  orgId,
  pdfFileId,
  pdfFileName,
  progress,
  disabled,
  onFile,
  onDetach,
}: {
  orgId: string;
  pdfFileId: string | null;
  pdfFileName: string | null;
  progress: PdfUploadProgress | null;
  disabled: boolean;
  onFile: (file: File) => void;
  onDetach: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const href = pdfFileId ? `/api/drive/files/${pdfFileId}/content?orgId=${encodeURIComponent(orgId)}` : null;

  return (
    <section className="team-lesson-edit-section team-lesson-pdf-card" aria-labelledby="team-lesson-pdf-title" data-lesson-field="pdf">
      <h2 id="team-lesson-pdf-title">The lesson PDF</h2>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      {pdfFileId && href ? (
        <p>
          <a href={href} target="_blank" rel="noopener noreferrer">
            {pdfFileName ?? "Lesson PDF"}
          </a>{" "}
          <span className="app-muted">— students read it here, then answer the practice questions below.</span>
        </p>
      ) : (
        <p className="team-lesson-notice">The PDF was removed from the team&apos;s Files. Upload it again, or write steps instead.</p>
      )}
      <div className="team-lesson-actions">
        <Button variant="secondary" disabled={disabled || progress !== null} onClick={onDetach}>
          Write steps instead
        </Button>
        <Button variant="secondary" disabled={disabled || progress !== null} onClick={() => input.current?.click()}>
          {pdfFileId ? "Replace the PDF" : "Upload the PDF"}
        </Button>
      </div>
      {progress ? (
        <div className="guided-progress" role="status" aria-live="polite">
          <span>{progress.label}</span>
          {progress.fraction !== null ? (
            <span className="guided-bar" aria-hidden="true">
              <i style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
