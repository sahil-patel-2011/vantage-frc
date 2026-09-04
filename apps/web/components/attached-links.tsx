"use client";

import { useState, type ReactNode } from "react";
import {
  linkLabelFromUrl,
  type AttachedLink,
} from "../lib/planner/links";

export function AttachedLinkChips({
  links,
  empty = null,
}: {
  links: AttachedLink[];
  empty?: ReactNode;
}) {
  if (links.length === 0) return empty;
  return (
    <ul className="planner-link-chips">
      {links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            {link.label || linkLabelFromUrl(link.url)}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function AttachedLinksEditor({
  links,
  onChange,
  disabled,
  placeholder = "https://docs.google.com/…",
  addLabel = "Attach link",
}: {
  links: AttachedLink[];
  onChange: (next: AttachedLink[]) => void;
  disabled?: boolean;
  placeholder?: string;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") throw new Error("Use an https:// link");
      if (links.some((link) => link.url === url.toString())) {
        setDraft("");
        setError("");
        return;
      }
      onChange([...links, { label: linkLabelFromUrl(url.toString()), url: url.toString() }]);
      setDraft("");
      setError("");
    } catch {
      setError("Paste a full https:// link");
    }
  };

  return (
    <div className="planner-links-editor">
      {links.length === 0 ? (
        <p className="app-muted planner-links-empty">No links yet — attach a doc, sheet, or CAD URL.</p>
      ) : null}
      {links.length > 0 ? (
        <ul className="planner-link-edit">
          {links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
              <button
                type="button"
                className="app-button secondary"
                disabled={disabled}
                onClick={() => onChange(links.filter((item) => item.url !== link.url))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="planner-link-add">
        <input
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={addLabel}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="app-button secondary" disabled={disabled || !draft.trim()} onClick={add}>
          {addLabel}
        </button>
      </div>
      {error ? (
        <p className="planner-link-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
