"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SectionHelpEntry } from "../lib/help/section-help";
import "./help-tip.css";

/**
 * HelpTip — the inline "?" affordance that answers how / why / when for the
 * surface you are already looking at.
 *
 * Popover on desktop, bottom sheet under 720px (CSS only — one DOM tree).
 * Escape closes and returns focus to the trigger; a pointer-down outside closes.
 * Renders nothing when the surface has no registry entry, so mounting it beside
 * a tab bar is always safe.
 */
export function HelpTip({
  entry,
  className,
}: {
  entry: SectionHelpEntry | null | undefined;
  className?: string;
}) {
  if (!entry) return null;
  return <HelpTipPopover entry={entry} className={className} />;
}

function HelpTipPopover({ entry, className }: { entry: SectionHelpEntry; className?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  return (
    <span className={["help-tip", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        className="help-tip-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`How ${entry.title} works`}
        title={`How ${entry.title} works`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="help-tip-scrim"
            aria-label="Dismiss help"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
          />
          <div
            ref={panelRef}
            className="help-tip-panel"
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="help-tip-head">
              <div>
                <span className="help-tip-eyebrow">How this works</span>
                <strong id={titleId}>{entry.title}</strong>
              </div>
              <button
                type="button"
                className="help-tip-close"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span aria-hidden="true">×</span>
                <span className="help-tip-sr">Close</span>
              </button>
            </header>

            <div className="help-tip-body">
              <HelpTipFact label="What" value={entry.what} />
              <HelpTipFact label="Why" value={entry.why} />
              <HelpTipFact label="When" value={entry.when} />

              <section className="help-tip-block">
                <h3>How</h3>
                <ol>
                  {entry.how.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>

              {entry.tips?.length ? (
                <section className="help-tip-block">
                  <h3>Tips</h3>
                  <ul>
                    {entry.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {entry.related.length ? (
                <section className="help-tip-block">
                  <h3>Related</h3>
                  <div className="help-tip-links">
                    {entry.related.map((link) => (
                      <a key={link.href} href={link.href}>
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <footer className="help-tip-foot">
              <a href="/docs?view=sections">All sections, season by season</a>
            </footer>
          </div>
        </>
      ) : null}
    </span>
  );
}

function HelpTipFact({ label, value }: { label: string; value: string }) {
  return (
    <p className="help-tip-fact">
      <span>{label}</span>
      {value}
    </p>
  );
}

export default HelpTip;
