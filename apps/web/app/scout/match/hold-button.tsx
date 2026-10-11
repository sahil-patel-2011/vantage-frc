"use client";

import { useRef, type ReactNode } from "react";

/** A press shorter than this is a tap: it locks the action on until the next tap. */
const TAP_MS = 320;

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Haptics are a nicety; some browsers refuse them outright.
  }
}

/**
 * Hold while the robot does it; let go when it stops. A quick tap locks it on instead,
 * for a scout who needs that hand for the counter, and the next tap stops it. Keyboard
 * and switch users get the tap behaviour from Enter or Space.
 */
export function HoldButton({
  active,
  disabled,
  tone,
  label,
  detail,
  icon,
  onStart,
  onStop,
}: {
  active: boolean;
  disabled?: boolean;
  tone: "shooting" | "feeding" | "defending" | "disabled";
  label: string;
  detail: string;
  icon: ReactNode;
  onStart(): void;
  onStop(): void;
}) {
  const pressedAt = useRef<number | null>(null);
  const startedHere = useRef(false);

  function down(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressedAt.current = Date.now();
    startedHere.current = !active;
    if (!active) {
      buzz();
      onStart();
    }
  }

  function up() {
    const at = pressedAt.current;
    pressedAt.current = null;
    if (at === null) return;
    const held = Date.now() - at;
    // Held: it ran for as long as the finger was down. Tapped while running: stop.
    // Tapped while stopped: it started on the way down and stays locked on.
    if ((startedHere.current && held >= TAP_MS) || !startedHere.current) {
      buzz();
      onStop();
    }
    startedHere.current = false;
  }

  return (
    <button
      type="button"
      className={`qs-hold qs-hold-${tone}${active ? " is-on" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        // Enter, Space and assistive tech arrive as a click with no pointer press (detail 0);
        // a finger or mouse press was already handled on the way down and up.
        if (event.detail !== 0 || disabled) return;
        buzz();
        if (active) onStop();
        else onStart();
      }}
    >
      <span className="qs-hold-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="qs-hold-text">
        <strong>{label}</strong>
        <small>{active ? "Recording · tap or let go to stop" : detail}</small>
      </span>
    </button>
  );
}
