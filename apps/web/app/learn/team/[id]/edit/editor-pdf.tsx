"use client";

import { useRef } from "react";
import { Button } from "../../../../../components/ui";
import type { PdfUploadProgress } from "./lesson-pdf-upload";

/**
 * "Upload PDF instead": the lesson's content becomes a PDF from the team's Files. Shown as a
 * card above the steps; once a PDF is attached it replaces the step list in the editor.
 */
export function PdfPanel({
  orgId,
  source,
  pdfFileId,
  pdfFileName,
  progress,
  highlighted,
  disabled,
  onFile,
  onDetach,
}: {
  orgId: string;
  source: "editor" | "pdf";
  pdfFileId: string | null;
  pdfFileName: string | null;
  progress: PdfUploadProgress | null;
  highlighted: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  onDetach: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const choose = () => input.current?.click();
  const href = pdfFileId ? `/api/drive/files/${pdfFileId}/content?orgId=${encodeURIComponent(orgId)}` : null;

  return (
    <section className={`team-lesson-edit-section team-lesson-pdf-card${highlighted ? " is-highlighted" : ""}`} aria-labelledby="team-lesson-pdf-title">
      <h2 id="team-lesson-pdf-title">{source === "pdf" ? "The lesson PDF" : "Already have this lesson as a PDF?"}</h2>
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
      {source === "pdf" ? (
        <>
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
            <Button variant="secondary" disabled={disabled || progress !== null} onClick={choose}>
              Replace the PDF
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="app-muted">
            Upload it and students read the PDF here, then answer your practice questions. It is saved in your team&apos;s
            Files, in the Team lessons folder. PDF files only, up to the size Files accepts.
          </p>
          <div className="team-lesson-actions">
            <Button variant="secondary" disabled={disabled || progress !== null} onClick={choose}>
              Upload PDF instead
            </Button>
          </div>
        </>
      )}
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
