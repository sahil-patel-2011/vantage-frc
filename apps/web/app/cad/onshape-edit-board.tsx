"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import {
  CAD_PASTE_LINK_HINT,
  CAD_PASTE_LINK_LABEL,
  EDIT_IN_ONSHAPE,
  ONSHAPE_EDIT_BOARD_HINT,
  ONSHAPE_EDIT_BOARD_TITLE,
  onshapeEditHref,
  onshapeEditLabel,
  onshapeEmbedHref,
  parsePastedOnshapeLink,
} from "../../lib/cad/onshape-edit-link";

export function OnshapeEditButton({
  href,
  title,
  variant = "primary",
}: {
  href: string;
  title?: string | null;
  variant?: "primary" | "secondary";
}) {
  return (
    <Button as="a" variant={variant} href={href} target="_blank" rel="noreferrer noopener">
      {onshapeEditLabel(title)}
    </Button>
  );
}

/**
 * Official Onshape document embed. Same URL as Share → Embed / the address bar.
 * Edit in Onshape stays the primary if the iframe is blocked by the browser.
 */
export function OnshapeDocumentEmbed({
  url,
  title,
}: {
  url: string;
  title?: string | null;
}) {
  const embed = onshapeEmbedHref(url);
  if (!embed) return null;
  return (
    <iframe
      className="onshape-edit-embed"
      title={title?.trim() || "Onshape document"}
      src={embed}
      referrerPolicy="strict-origin-when-cross-origin"
      allow="fullscreen"
    />
  );
}

export function OnshapeEditBoard({
  initialUrl = "",
  title,
  compact = false,
}: {
  initialUrl?: string;
  title?: string | null;
  compact?: boolean;
}) {
  const [paste, setPaste] = useState(initialUrl);
  const parsed = useMemo(() => {
    const trimmed = paste.trim();
    if (!trimmed) return { ok: true as const, href: onshapeEditHref(initialUrl), error: "" };
    try {
      const value = parsePastedOnshapeLink(trimmed);
      return { ok: true as const, href: onshapeEditHref(value.url), error: "" };
    } catch (error) {
      return {
        ok: false as const,
        href: null,
        error: error instanceof Error ? error.message : "Paste an Onshape document link.",
      };
    }
  }, [paste, initialUrl]);

  const href = parsed.href;
  const heading = compact ? null : (
    <header>
      <h2>{ONSHAPE_EDIT_BOARD_TITLE}</h2>
      <p className="app-muted">{ONSHAPE_EDIT_BOARD_HINT}</p>
    </header>
  );

  return (
    <section className="app-card onshape-edit-board" aria-label={ONSHAPE_EDIT_BOARD_TITLE}>
      {heading}
      <label>
        {CAD_PASTE_LINK_LABEL}
        <small>{CAD_PASTE_LINK_HINT}</small>
        <input
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder="https://cad.onshape.com/documents/…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {parsed.error ? (
        <p className="app-muted" role="status">
          {parsed.error}
        </p>
      ) : null}
      {href ? (
        <>
          <div className="onshape-edit-board-actions">
            <OnshapeEditButton href={href} title={title} />
          </div>
          <OnshapeDocumentEmbed url={href} title={title} />
        </>
      ) : compact ? null : (
        <p className="app-muted">Paste a link to edit the live Onshape document.</p>
      )}
    </section>
  );
}

export { EDIT_IN_ONSHAPE };
