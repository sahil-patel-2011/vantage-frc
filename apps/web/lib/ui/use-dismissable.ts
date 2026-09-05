import { useEffect, type RefObject } from "react";

export type DismissRoot = { contains(node: unknown): boolean } | null | undefined;

/** True when the event target is outside every root (click-away / light dismiss). */
export function isOutsideTarget(target: unknown, roots: readonly DismissRoot[]): boolean {
  return !roots.some((root) => {
    try {
      return Boolean(root?.contains(target));
    } catch {
      return false;
    }
  });
}

/**
 * Close a popover/sheet on pointer-down outside its root, or Escape.
 *
 * Keep the trigger inside `rootRef` so a second tap on it can still toggle. When
 * the trigger lives elsewhere in the tree — the drawer's hamburger sits in the
 * topbar, not in the drawer — pass it as `triggerRef`, or its pointer-down
 * closes here and its click re-opens immediately after.
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<Element | null>,
  triggerRef?: RefObject<Element | null>,
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!isOutsideTarget(event.target, [rootRef.current, triggerRef?.current])) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, rootRef, triggerRef]);
}
