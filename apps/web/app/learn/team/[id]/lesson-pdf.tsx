"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../../components/ui";

/**
 * A lesson PDF from the team's Files, shown inline. The bytes come from Files' own download
 * route; they are shown from a blob: address because the app's pages refuse to be framed
 * (X-Frame-Options), which would otherwise blank the viewer. When the browser cannot show it
 * (a storage node elsewhere, a phone without a PDF viewer) the open and download links remain.
 */
export function LessonPdf({ orgId, fileId, fileName }: { orgId: string; fileId: string; fileName: string | null }) {
  const src = `/api/drive/files/${fileId}/content?orgId=${encodeURIComponent(orgId)}`;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setState("loading");
    setBlobUrl(null);
    void fetch(src, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("not ok");
        const blob = await response.blob();
        const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        created = URL.createObjectURL(pdf);
        if (cancelled) return;
        setBlobUrl(created);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  const title = fileName ?? "Lesson PDF";
  return (
    <section className="team-lesson-pdf" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <div className="team-lesson-pdf-links">
          <Button as="a" variant="secondary" size="sm" href={src} target="_blank" rel="noopener noreferrer">
            Open in a new tab
          </Button>
          <Button as="a" variant="ghost" size="sm" href={`${src}&download=1`}>
            Download PDF
          </Button>
        </div>
      </header>
      {state === "ready" && blobUrl ? (
        <iframe className="team-lesson-pdf-frame" src={blobUrl} title={title} />
      ) : (
        <p className="team-lesson-pdf-status" role="status">
          {state === "loading"
            ? "Loading the PDF…"
            : "This PDF can't be shown on this page. Open it in a new tab or download it, then come back for the practice questions."}
        </p>
      )}
    </section>
  );
}
