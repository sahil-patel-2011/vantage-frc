"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import {
  EDIT_IN_FUSION,
  FUSION_EDIT_BOARD_HINT,
  FUSION_EDIT_BOARD_TITLE,
  FUSION_PASTE_LINK_HINT,
  FUSION_PASTE_LINK_LABEL,
  FUSION_PASTE_PLACEHOLDER,
  fusionEditHref,
  fusionEditLabel,
  parsePastedFusionLink,
} from "../../lib/cad/fusion-edit-link";

export function FusionEditButton({
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
      {fusionEditLabel(title)}
    </Button>
  );
}

/**
 * Paste a Fusion share link and open it. No iframe — Fusion stays on this
 * computer, and the Onshape viewport is left alone.
 */
export function FusionEditBoard({
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
    if (!trimmed) return { ok: true as const, href: fusionEditHref(initialUrl), error: "" };
    try {
      const value = parsePastedFusionLink(trimmed);
      return { ok: true as const, href: fusionEditHref(value.url), error: "" };
    } catch (error) {
      return {
        ok: false as const,
        href: null,
        error: error instanceof Error ? error.message : "Paste a Fusion share link.",
      };
    }
  }, [paste, initialUrl]);

  const href = parsed.href;
  const heading = compact ? null : (
    <header>
      <h2>{FUSION_EDIT_BOARD_TITLE}</h2>
      <p className="app-muted">{FUSION_EDIT_BOARD_HINT}</p>
    </header>
  );

  return (
    <section
      className={compact ? "fusion-edit-board" : "app-card fusion-edit-board"}
      aria-label={FUSION_EDIT_BOARD_TITLE}
    >
      {heading}
      <label>
        {FUSION_PASTE_LINK_LABEL}
        <small>{FUSION_PASTE_LINK_HINT}</small>
        <input
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder={FUSION_PASTE_PLACEHOLDER}
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
        <div className="fusion-edit-board-actions">
          <FusionEditButton href={href} title={title} />
        </div>
      ) : compact ? null : (
        <p className="app-muted">Paste a link to edit the live Fusion document.</p>
      )}
    </section>
  );
}

export { EDIT_IN_FUSION };
