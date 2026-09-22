"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Close an open panel by clicking away from it, or by pressing Escape.
 *
 * Twelve disclosures in this app could only be closed by pressing their own
 * trigger again — the tool strips, the CAD tools and activity panels, the board
 * bar, the topbar menu. Every other app on the phone dismisses a menu when you
 * tap outside it, so the reflex is already there and ignoring it is what makes
 * an interface feel stiff. Eleven of them had no Escape either, which leaves a
 * keyboard user stuck in an open menu.
 *
 * Put the returned ref on the element that wraps BOTH the trigger and the
 * panel. Wrapping only the panel is the classic version of this bug: pressing
 * the trigger to close fires a pointerdown outside the panel (closing it), then
 * a click on the trigger (reopening it), and the menu appears frozen open.
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Kept in a ref so a caller passing an inline arrow does not re-subscribe on
  // every render — which would drop the listener mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const target = event.target;
      // A click on something that has already left the DOM (a row that removed
      // itself) reports a detached target; treat that as inside, not outside,
      // or acting on a menu item would also close its own menu.
      if (!(target instanceof Node) || !target.isConnected) return;
      if (node.contains(target)) return;
      onCloseRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stop here so one Escape closes one layer. Without this, a panel inside
      // a modal closes both at once.
      event.stopPropagation();
      onCloseRef.current();
    };

    // pointerdown, not click: click fires on release, so a drag that starts
    // inside the panel and ends outside it would dismiss. Capture phase, so a
    // child calling stopPropagation cannot swallow the dismissal.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return ref;
}
