"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FeedbackBugIcon } from "./feedback-bug-icon";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import {
  BUG_DESCRIPTION_MAX,
  BUG_KINDS,
  BUG_KIND_LABELS,
  BUG_KIND_PLACEHOLDERS,
  type BugKind,
} from "../lib/feedback/bug-report";
import { clearFeedbackDraft, readFeedbackDraft, writeFeedbackDraft } from "../lib/feedback/feedback-draft";
import { FEEDBACK_OPEN_EVENT, feedbackOpenKind, markFeedbackHandled } from "../lib/feedback/feedback-open";
import { feedbackButtonAllowedOn } from "../lib/feedback/feedback-routes";
import { buildFeedbackPayload, sendFeedback } from "../lib/feedback/feedback-submit";
import "./feedback-button.css";

/**
 * Send feedback: the small round bug button in the bottom-right corner and the dialog behind it.
 *
 * The same dialog opens from the account menu and the Help page, which dispatch
 * `vantage:feedback-open` (lib/feedback/feedback-open.ts); this component owns the listener, so
 * those places do not import it. The button itself stays out of the way on focused task screens
 * (lib/feedback/feedback-routes.ts) and while a dialog or the tour is up (feedback-button.css).
 */

/** After a successful send the thanks stays up this long, then the dialog closes itself. */
export const FEEDBACK_THANKS_MS = 1500;
/** The character count appears only when the limit is near. */
const COUNT_FROM = Math.floor(BUG_DESCRIPTION_MAX * 0.9);

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />
    </svg>
  );
}

type Phase = "idle" | "sending" | "sent";

export function FeedbackButton({ orgId, signedIn, showTrigger = true }: { orgId?: string | null; signedIn: boolean; showTrigger?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BugKind>("bug");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const sentRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const textRef = useRef("");
  const kindRefs = useRef<Record<BugKind, HTMLButtonElement | null>>({ bug: null, idea: null });

  const stopCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openDialog = useCallback(
    (requested?: BugKind) => {
      stopCloseTimer();
      const draft = readFeedbackDraft();
      // What is still in the box wins over the stored copy; a reload leaves only the stored copy.
      const kept = textRef.current || draft?.text || "";
      textRef.current = kept;
      setText(kept);
      setKind(requested ?? draft?.kind ?? "bug");
      setPhase("idle");
      setError("");
      setOpen(true);
    },
    [stopCloseTimer],
  );

  const closeDialog = useCallback(() => {
    stopCloseTimer();
    setOpen(false);
  }, [stopCloseTimer]);

  // Other places open this dialog by event; only a signed-in person has anything to send it to.
  useEffect(() => {
    if (!signedIn) return;
    const onOpen = (event: Event) => {
      markFeedbackHandled(event);
      openDialog(feedbackOpenKind(event));
    };
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, [signedIn, openDialog]);

  useEffect(() => stopCloseTimer, [stopCloseTimer]);

  // The dialog gives focus back to whatever opened it. When that was a menu item that has since
  // closed, there is nothing to give it back to, so the button takes it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const id = window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) buttonRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (phase === "sent") sentRef.current?.focus();
  }, [phase]);

  const changeText = (value: string) => {
    textRef.current = value;
    setText(value);
    if (error) setError("");
    writeFeedbackDraft({ kind, text: value });
  };

  const changeKind = (next: BugKind) => {
    setKind(next);
    writeFeedbackDraft({ kind: next, text });
  };

  const onKindKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next: BugKind = kind === "bug" ? "idea" : "bug";
    changeKind(next);
    kindRefs.current[next]?.focus();
  };

  const canSend = phase === "idle" && text.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const sentText = text;
    setPhase("sending");
    setError("");
    const payload = buildFeedbackPayload({
      kind,
      text: sentText,
      route: `${window.location.pathname}${window.location.search}`,
      orgId: orgId || new URLSearchParams(window.location.search).get("orgId"),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    const result = await sendFeedback(payload);
    if (result.ok) {
      clearFeedbackDraft();
      // Only empty the box if nothing new was typed while this was on its way.
      if (textRef.current === sentText) {
        textRef.current = "";
        setText("");
      }
      setPhase("sent");
      stopCloseTimer();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setOpen(false);
      }, FEEDBACK_THANKS_MS);
      return;
    }
    setPhase("idle");
    setError(result.message);
  };

  const showButton = showTrigger && signedIn && feedbackButtonAllowedOn(pathname);
  const nearLimit = text.length >= COUNT_FROM;

  return (
    <>
      {showButton ? (
        <button
          ref={buttonRef}
          type="button"
          className="feedback-fab"
          data-tour="feedback"
          aria-label="Send feedback"
          aria-haspopup="dialog"
          title="Send feedback"
          onClick={() => openDialog()}
        >
          <FeedbackBugIcon />
        </button>
      ) : null}
      <Modal open={open && signedIn} onClose={closeDialog} title="Send feedback" hideClose className="feedback-dialog">
        <form
          className="feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {phase === "sent" ? (
            <div className="feedback-sent" role="status" tabIndex={-1} ref={sentRef}>
              <span className="feedback-sent-check">
                <CheckIcon />
              </span>
              <p>Thanks — we got it.</p>
            </div>
          ) : (
            <>
              <div className="feedback-kinds" role="radiogroup" aria-label="What kind of feedback is this?">
                {BUG_KINDS.map((value) => (
                  <button
                    key={value}
                    ref={(node) => {
                      kindRefs.current[value] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    tabIndex={kind === value ? 0 : -1}
                    className="feedback-kind"
                    onClick={() => changeKind(value)}
                    onKeyDown={onKindKeyDown}
                  >
                    {BUG_KIND_LABELS[value]}
                  </button>
                ))}
              </div>
              <textarea
                className="feedback-text"
                data-autofocus
                value={text}
                readOnly={phase === "sending"}
                maxLength={BUG_DESCRIPTION_MAX}
                rows={5}
                placeholder={BUG_KIND_PLACEHOLDERS[kind]}
                aria-label={BUG_KIND_PLACEHOLDERS[kind]}
                aria-describedby="feedback-note"
                onChange={(event) => changeText(event.target.value)}
                onKeyDown={(event) => {
                  // Enter is a new line; Ctrl or Cmd with Enter sends.
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="feedback-foot">
                <p id="feedback-note" className="feedback-note">
                  We&rsquo;ll include your note, the page you&rsquo;re on and your screen size. It goes to the Vantage
                  team, not your team.
                </p>
                {nearLimit ? (
                  <span className="feedback-count" data-full={text.length >= BUG_DESCRIPTION_MAX || undefined}>
                    {text.length.toLocaleString()} / {BUG_DESCRIPTION_MAX.toLocaleString()}
                  </span>
                ) : null}
              </div>
              {error ? (
                <p className="feedback-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="feedback-actions">
                <Button variant="secondary" size="sm" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  className="feedback-send"
                  disabled={!canSend}
                  aria-busy={phase === "sending" || undefined}
                >
                  <span className="feedback-send-label" data-sending={phase === "sending" || undefined}>
                    Send
                  </span>
                  {phase === "sending" ? (
                    <>
                      <span className="feedback-spinner" aria-hidden="true" />
                      <span className="sr-only">Sending</span>
                    </>
                  ) : null}
                </Button>
              </div>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}
