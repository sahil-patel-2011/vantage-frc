"use client";

/**
 * The page a share link opens.
 *
 * The person reading this has no Vantage account and probably no idea what
 * Vantage is — they are a parent, a sponsor, a judge, or a mentor from another
 * team. So there is no sign-in prompt, no marketing, and no nav shell: just who
 * shared what, and a way to open it. The one piece of product voice is the line
 * explaining that whoever holds the link can open it, because a recipient about
 * to forward it deserves to know that.
 */

import { useCallback, useEffect, useState } from "react";
import { drivePreviewKind, formatDriveBytes } from "../../../lib/drive/validation";

type ShareFile = {
  id: string;
  name: string;
  contentType: string;
  contentClass: string;
  byteSize: number;
  hasThumb: boolean;
  createdAt: string;
};

type SharePayload = {
  kind: "file" | "folder";
  canDownload: boolean;
  expiresAt: string | null;
  note: string | null;
  sharedWith: string | null;
  orgName: string;
  teamNumber: number | null;
  folderName: string | null;
  files: ShareFile[];
};

type State =
  | { status: "loading" }
  | { status: "gone"; message: string }
  | { status: "outage"; message: string }
  | { status: "ready"; share: SharePayload };

function teamLabel(share: SharePayload): string {
  return share.teamNumber ? `Team ${share.teamNumber} · ${share.orgName}` : share.orgName;
}

export default function SharePageClient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState<ShareFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/drive-share/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          share?: SharePayload;
          error?: string;
        };
        if (cancelled) return;
        if (response.status === 503) {
          setState({
            status: "outage",
            message: body.error ?? "We could not load this right now. Please try again in a minute.",
          });
          return;
        }
        if (!response.ok || !body.share) {
          setState({
            status: "gone",
            message:
              body.error ?? "This link is not valid, has expired, or the team has turned it off.",
          });
          return;
        }
        setState({ status: "ready", share: body.share });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "outage",
            message: "We could not reach Vantage. Check your connection and try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fileHref = useCallback(
    (file: ShareFile, download: boolean) =>
      `/api/drive-share/${token}/download?fileId=${file.id}${download ? "&download=1" : ""}`,
    [token],
  );

  if (state.status === "loading") {
    return (
      <main className="share-page">
        <p className="share-muted">Loading…</p>
      </main>
    );
  }

  if (state.status === "gone" || state.status === "outage") {
    return (
      <main className="share-page">
        <section className="share-card">
          <h1>{state.status === "gone" ? "This link no longer works" : "Something went wrong"}</h1>
          <p>{state.message}</p>
          {state.status === "gone" ? (
            <p className="share-muted">
              If you were expecting a file, ask the person who sent it to share it again — a new link
              takes them a few seconds.
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  const { share } = state;

  return (
    <main className="share-page">
      <section className="share-card">
        <header className="share-header">
          <p className="share-eyebrow">{teamLabel(share)} shared this with you</p>
          <h1>{share.kind === "folder" ? (share.folderName ?? "A folder") : (share.files[0]?.name ?? "A file")}</h1>
          {share.note ? <p className="share-note">{share.note}</p> : null}
        </header>

        {share.files.length === 0 ? (
          <p className="share-muted">
            There is nothing in here right now. The team may have moved or removed it.
          </p>
        ) : (
          <ul className="share-files">
            {share.files.map((file) => {
              const previewable = drivePreviewKind(file.contentType) !== null;
              return (
                <li key={file.id}>
                  <div>
                    <strong>{file.name}</strong>
                    <span className="share-muted">
                      {formatDriveBytes(file.byteSize)} · {file.contentType}
                    </span>
                  </div>
                  <div className="share-file-actions">
                    {previewable ? (
                      <button type="button" className="share-button ghost" onClick={() => setOpen(file)}>
                        View
                      </button>
                    ) : null}
                    {share.canDownload ? (
                      <a className="share-button" href={fileHref(file, true)}>
                        Download
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="share-footer">
          {!share.canDownload ? (
            <p className="share-muted">
              This link is view-only, so there is no download button. (Being straight with you: that
              stops an accidental copy, not a determined one — anything your browser can display can
              be captured.)
            </p>
          ) : null}
          <p className="share-muted">
            Anyone holding this link can open it — you do not need an account, and neither does anyone
            you forward it to. Please treat it like a key.
            {share.expiresAt
              ? ` It stops working on ${new Date(share.expiresAt).toLocaleString()}.`
              : ""}
          </p>
          <p className="share-muted share-brand">Shared with Vantage</p>
        </footer>
      </section>

      {open ? (
        <div className="share-preview" role="dialog" aria-modal="true" aria-label={open.name}>
          <div className="share-preview-inner">
            <header>
              <strong>{open.name}</strong>
              <button type="button" className="share-button" onClick={() => setOpen(null)}>
                Close
              </button>
            </header>
            <div className="share-preview-body">
              <PreviewBody file={open} src={fileHref(open, false)} />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PreviewBody({ file, src }: { file: ShareFile; src: string }) {
  const kind = drivePreviewKind(file.contentType);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    void fetch(src)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("read failed"))))
      .then((body) => {
        if (!cancelled) setText(body.slice(0, 200_000));
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, src]);

  if (kind === "image") {
     
    return <img src={src} alt={file.name} />;
  }
  if (kind === "video") {
    // Exactly the file the team uploaded — Vantage transcodes nothing, so a
    // codec your browser cannot play will say so rather than being converted.
    return <video src={src} controls preload="metadata" />;
  }
  if (kind === "audio") return <audio src={src} controls preload="metadata" />;
  if (kind === "pdf") return <iframe src={src} title={file.name} />;
  if (kind === "text") return <pre>{text ?? "Loading…"}</pre>;
  return <p className="share-muted">This kind of file has to be downloaded to open.</p>;
}
