"use client";

import { useEffect, useMemo, useState } from "react";
import { withOrgHref } from "../lib/nav/product-nav";

export type VenueShortcut = {
  key: string;
  label: string;
  href: string;
};

/** Competition-hub hotkeys — skip when typing in inputs. */
export function venueShortcutsForOrg(orgId: string | null | undefined): VenueShortcut[] {
  return [
    { key: "s", label: "Scouting", href: withOrgHref("/scouting", orgId ?? null) },
    { key: "e", label: "Event Day Command", href: withOrgHref("/command", orgId ?? null) },
    { key: "y", label: "Strategy", href: withOrgHref("/strategy", orgId ?? null) },
    { key: "d", label: "Dashboard", href: withOrgHref("/dashboard", orgId ?? null) },
    { key: "m", label: "My Day", href: withOrgHref("/my-day", orgId ?? null) },
  ];
}

/**
 * Venue-friendly single-key jumps on high-traffic competition pages.
 * `?` opens a small cheatsheet; Escape closes it.
 */
export function useVenueShortcuts(orgId: string | null | undefined) {
  const [cheatOpen, setCheatOpen] = useState(false);
  const shortcuts = useMemo(() => venueShortcutsForOrg(orgId), [orgId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setCheatOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setCheatOpen(false);
        return;
      }
      const hit = shortcuts.find((row) => row.key === event.key.toLowerCase());
      if (hit) {
        event.preventDefault();
        window.location.assign(hit.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  return { cheatOpen, setCheatOpen, shortcuts };
}

export function VenueShortcutCheatsheet({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean;
  onClose: () => void;
  shortcuts: VenueShortcut[];
}) {
  if (!open) return null;
  return (
    <div
      className="venue-shortcut-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-shortcut-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="venue-shortcut-title">Venue shortcuts</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="app-muted">Press a key to jump — works on Scouting, Event Day, Strategy, and Dashboard.</p>
        <ul>
          {shortcuts.map((row) => (
            <li key={row.key}>
              <kbd>{row.key.toUpperCase()}</kbd>
              <span>{row.label}</span>
            </li>
          ))}
          <li>
            <kbd>?</kbd>
            <span>Toggle this help</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
