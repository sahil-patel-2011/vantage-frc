"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  buildActionModel,
  type ActionSpec,
  type BuildActionModelOptions,
  type ResolvedAction,
} from "../../lib/ui/action-model";
import "./action-menu.css";

export type { ActionSpec } from "../../lib/ui/action-model";

type ActionMenuProps = {
  /** Every action this surface offers. Order is a hint; see buildActionModel. */
  actions: readonly ActionSpec[];
  /** Names the action group and the overflow trigger for screen readers. Required. */
  label: string;
  /** How many neutral buttons sit beside the primary. Default 2. */
  maxSecondary?: BuildActionModelOptions["maxSecondary"];
  allowDisabledPrimary?: BuildActionModelOptions["allowDisabledPrimary"];
  /** Which edge the overflow menu hangs from. Default "end" (right in LTR). */
  align?: "start" | "end";
  /** Compact row for table/list rows: the primary renders neutral, not brand. */
  tone?: "page" | "row";
  className?: string;
  /** Text on the overflow trigger. Default "More". */
  overflowLabel?: string;
  /** Override when several menus share a page (list rows) so E2E selectors stay unique. */
  triggerTestId?: string;
};

/**
 * ONE primary action plus its variants — the standard replacement for a row of six
 * sibling buttons.
 *
 * The primary (and at most two secondary) actions render as real buttons; everything else
 * lives behind a single overflow menu. Destructive actions are always in the overflow and
 * always take a second, in-menu confirmation step — no dependency on a ConfirmProvider being
 * mounted, so this primitive is safe to drop into any surface.
 *
 * Keyboard: the trigger opens with Enter/Space/ArrowDown/ArrowUp, arrows and Home/End move
 * between items, Escape closes and returns focus to the trigger, Tab closes and moves on.
 * Targets are >= 44px on coarse pointers.
 */
export function ActionMenu({
  actions,
  label,
  maxSecondary,
  allowDisabledPrimary,
  align = "end",
  tone = "page",
  className,
  overflowLabel = "More",
  triggerTestId = "action-menu-trigger",
}: ActionMenuProps) {
  const model = useMemo(
    () => buildActionModel(actions, { maxSecondary, allowDisabledPrimary }),
    [actions, maxSecondary, allowDisabledPrimary],
  );

  const [open, setOpen] = useState(false);
  /**
   * The menu is portalled to <body> and positioned fixed against the trigger's rect, so an
   * ancestor with `overflow: auto` (every scrollable table in this app) can't clip it.
   */
  const [anchor, setAnchor] = useState<CSSProperties | null>(null);
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** Index to focus on the next open; -1 means "last item" (ArrowUp opened it). */
  const focusOnOpen = useRef<number>(0);
  const menuId = useId();

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setPendingConfirmId(null);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  // Close on outside pointer-down, on Escape anywhere, and on any scroll/resize that would
  // strand the fixed-position menu away from its trigger.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const onReflow = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, close]);

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []),
    [],
  );

  // Move focus into the menu once it exists.
  useEffect(() => {
    if (!open) return;
    const nodes = items();
    if (!nodes.length) return;
    const index = focusOnOpen.current === -1 ? nodes.length - 1 : Math.min(focusOnOpen.current, nodes.length - 1);
    nodes[index]?.focus();
  }, [open, items]);

  const moveFocus = (delta: number | "first" | "last") => {
    const nodes = items().filter((node) => node.getAttribute("aria-disabled") !== "true");
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (delta === "first") next = 0;
    else if (delta === "last") next = nodes.length - 1;
    else next = current < 0 ? 0 : (current + delta + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  const openMenu = (from: "top" | "bottom") => {
    focusOnOpen.current = from === "bottom" ? -1 : 0;
    setPendingConfirmId(null);
    setAnchor(anchorStyle(triggerRef.current, align));
    setOpen(true);
  };

  const run = (action: ResolvedAction) => {
    if (action.disabled) return;
    if (action.needsConfirm && pendingConfirmId !== action.id) {
      setPendingConfirmId(action.id);
      return;
    }
    close(false);
    action.onClick?.();
  };

  const hasOverflow = model.overflow.length > 0;

  return (
    <div
      className={["vam-root", tone === "row" ? "vam-row" : undefined, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      ref={wrapRef}
    >
      {model.primary ? <FlatAction action={model.primary} tone={tone} /> : null}
      {model.secondary.map((action) => (
        <FlatAction key={action.id} action={action} tone={tone} />
      ))}

      {hasOverflow ? (
        <div className="vam-overflow">
          <button
            type="button"
            ref={triggerRef}
            className="vam-btn vam-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={`${label}: ${overflowLabel}`}
            data-testid={triggerTestId}
            onClick={() => (open ? close(false) : openMenu("top"))}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                openMenu("top");
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                openMenu("bottom");
              }
            }}
          >
            <span aria-hidden="true" className="vam-dots">
              •••
            </span>
            <span className="vam-trigger-text">{overflowLabel}</span>
            <span className="vam-count" aria-hidden="true">
              {model.overflow.length}
            </span>
          </button>

          {open && typeof document !== "undefined"
            ? createPortal(
            <div
              id={menuId}
              ref={menuRef}
              className="vam-menu"
              style={anchor ?? undefined}
              role="menu"
              aria-label={label}
              onKeyDown={(event) => {
                switch (event.key) {
                  case "ArrowDown":
                    event.preventDefault();
                    moveFocus(1);
                    break;
                  case "ArrowUp":
                    event.preventDefault();
                    moveFocus(-1);
                    break;
                  case "Home":
                    event.preventDefault();
                    moveFocus("first");
                    break;
                  case "End":
                    event.preventDefault();
                    moveFocus("last");
                    break;
                  case "Tab":
                    close(false);
                    break;
                  default:
                    break;
                }
              }}
            >
              {model.overflow.map((action, index) => {
                const prev = model.overflow[index - 1];
                const separated = index > 0 && (prev?.group ?? "") !== (action.group ?? "");
                const confirming = pendingConfirmId === action.id;
                const commonProps = {
                  role: "menuitem" as const,
                  "data-menu-item": "true",
                  "data-testid": action.testId,
                  tabIndex: -1,
                  className: [
                    "vam-item",
                    separated ? "vam-item-sep" : undefined,
                    action.needsConfirm ? "vam-item-danger" : undefined,
                    confirming ? "vam-item-confirming" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" "),
                };

                if (action.href && !action.needsConfirm) {
                  return (
                    <a
                      {...commonProps}
                      key={action.id}
                      href={action.href}
                      aria-disabled={action.disabled ? true : undefined}
                      onClick={(event) => {
                        if (action.disabled) {
                          event.preventDefault();
                          return;
                        }
                        close(false);
                        action.onClick?.();
                      }}
                    >
                      <ItemBody action={action} confirming={false} />
                    </a>
                  );
                }

                return (
                  <button
                    {...commonProps}
                    key={action.id}
                    type="button"
                    disabled={action.disabled}
                    aria-disabled={action.disabled ? true : undefined}
                    onClick={() => run(action)}
                    onBlur={() => {
                      if (confirming) setPendingConfirmId(null);
                    }}
                  >
                    <ItemBody action={action} confirming={confirming} />
                  </button>
                );
              })}
            </div>,
                document.body,
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fixed-position coordinates for the menu, measured from the trigger. Flips above the
 * trigger when the viewport bottom is closer than the menu could comfortably use.
 */
function anchorStyle(trigger: HTMLElement | null, align: "start" | "end"): CSSProperties | null {
  if (!trigger || typeof window === "undefined") return null;
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const spaceBelow = window.innerHeight - rect.bottom;
  const flipUp = spaceBelow < 240 && rect.top > spaceBelow;
  const vertical: CSSProperties = flipUp
    ? { bottom: Math.max(8, window.innerHeight - rect.top + gap), maxHeight: Math.max(160, rect.top - gap - 8) }
    : { top: rect.bottom + gap, maxHeight: Math.max(160, spaceBelow - gap - 8) };
  const horizontal: CSSProperties =
    align === "start"
      ? { left: Math.max(8, rect.left) }
      : { right: Math.max(8, window.innerWidth - rect.right) };
  return { position: "fixed", ...vertical, ...horizontal };
}

function ItemBody({ action, confirming }: { action: ResolvedAction; confirming: boolean }) {
  return (
    <>
      <span className="vam-item-main">
        <span className="vam-item-label">
          {confirming ? `Confirm: ${action.label}` : action.label}
        </span>
        {confirming ? (
          // Never overstate the blast radius: the caller's own hint is the honest one.
          <span className="vam-item-hint">
            {action.hint ? `${action.hint}. ` : ""}Press again to confirm.
          </span>
        ) : action.hint ? (
          <span className="vam-item-hint">{action.hint}</span>
        ) : null}
      </span>
      {action.shortcut && !confirming ? (
        <kbd className="vam-item-kbd">{action.shortcut}</kbd>
      ) : null}
    </>
  );
}

/** A primary or secondary action rendered as a real, always-visible control. */
function FlatAction({ action, tone }: { action: ResolvedAction; tone: "page" | "row" }) {
  const cls = [
    "vam-btn",
    action.placement === "primary" && tone === "page" ? "vam-primary" : "vam-secondary",
  ].join(" ");

  if (action.href) {
    return (
      <a
        className={cls}
        href={action.href}
        data-testid={action.testId}
        aria-disabled={action.disabled ? true : undefined}
        data-primary-action={action.placement === "primary" ? "true" : undefined}
        onClick={(event) => {
          if (action.disabled) {
            event.preventDefault();
            return;
          }
          action.onClick?.();
        }}
        title={action.hint}
      >
        {action.label}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={cls}
      data-testid={action.testId}
      data-primary-action={action.placement === "primary" ? "true" : undefined}
      disabled={action.disabled}
      onClick={() => action.onClick?.()}
      title={action.hint}
    >
      {action.label}
    </button>
  );
}
