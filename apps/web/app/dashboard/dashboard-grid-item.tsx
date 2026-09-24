"use client";

import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  WIDGET_SIZE_KEYS,
  WIDGET_SIZE_LABEL,
  isAlwaysShown,
  type DashboardWidgetLayout,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { DashboardWidgetView } from "./widgets";
import { DashboardCardActions } from "./dashboard-quick-actions";

type Box = { left: number; top: number; width: number; height: number };

type DashboardGridItemProps = {
  item: DashboardWidgetLayout;
  box: Box;
  label: string;
  editing: boolean;
  isDragging: boolean;
  isGrabbed: boolean;
  /** Its size button was tapped — its size controls stay out. */
  selected?: boolean;
  /** Just added — flashes once so you can see where it went. */
  isNew?: boolean;
  /** Why the normal Home leaves this card out, when it does. */
  hiddenNote?: string | null;
  currentSize: WidgetSizeKey;
  atDefault: boolean;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
  canOpenTeamData?: boolean;
  /** Open or close this card's size controls (null closes). */
  onSelect?: (id: string | null) => void;
  onCardPointerDown: (event: PointerEvent<HTMLElement>, item: DashboardWidgetLayout) => void;
  onHandlePointerDown: (event: PointerEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  onDragPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onDragPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onDragPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSizeKey) => void;
  onResetSize: (id: string) => void;
  /** Turns "Always show" back off; only offered on cards that have it. */
  onHideWhenEmpty?: (id: string) => void;
};

/*
  Edit-mode chrome is deliberately small. Each card used to carry a dark-red
  "× Remove" button over its title, a "DRAG" pill, and a five-button size bar,
  all at once — on a 4-column card that covered the name you needed to read to
  know which card it was. Now: a neutral "−" on the corner (outside the title),
  a grip tab on the top edge, a size button on the top-right corner, and the
  sizes only on the card whose size button you tapped. Tapping the card's
  content never picks it (the tap landed on its links and inputs), and the
  mouseup that ends a drag never does either.
*/
/*
  After a card is removed the next one slides into its place, with its "−" right
  under the pointer, and a double-click removed both. A second pointer click on
  the same spot within a moment of a remove is ignored; a keyboard press or a
  click somewhere else is not.
*/
let lastRemove = { at: 0, x: 0, y: 0 };
function isRepeatRemove(detail: number, x: number, y: number): boolean {
  if (detail === 0) return false;
  const now = Date.now();
  const repeat = now - lastRemove.at < 600 && Math.hypot(x - lastRemove.x, y - lastRemove.y) < 8;
  lastRemove = { at: now, x, y };
  return repeat;
}

export const DashboardGridItem = memo(function DashboardGridItem({
  item,
  box,
  label,
  editing,
  isDragging,
  isGrabbed,
  selected = false,
  isNew = false,
  hiddenNote = null,
  currentSize,
  atDefault,
  payload,
  orgId,
  tbaConfigured,
  canOpenTeamData = false,
  onSelect,
  onCardPointerDown,
  onHandlePointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel,
  onHandleKeyDown,
  onRemove,
  onResize,
  onResetSize,
  onHideWhenEmpty,
}: DashboardGridItemProps) {
  return (
    <article
      className={`dash-grid-item${editing ? " is-editing" : ""}${isDragging ? " is-dragging" : ""}${
        isGrabbed ? " is-grabbed" : ""
      }${selected ? " is-selected" : ""}${isNew ? " is-new" : ""}${hiddenNote ? " is-hidden-on-home" : ""}`}
      data-testid="dash-grid-item"
      data-widget-id={item.i}
      data-widget-type={item.type}
      data-widget-x={item.x}
      data-widget-y={item.y}
      style={
        {
          transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        } as CSSProperties
      }
      onPointerDown={(event) => onCardPointerDown(event, item)}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerUp}
      onPointerCancel={onDragPointerCancel}
    >
      {editing ? (
        <>
          <button
            type="button"
            className="dash-remove-badge"
            data-testid="dash-remove-widget"
            title={`Remove ${label}`}
            aria-label={`Remove ${label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (isRepeatRemove(event.detail, event.clientX, event.clientY)) return;
              onRemove(item.i);
            }}
          >
            <span aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dash-card-grip dash-drag-surface"
            data-testid="dash-drag-handle"
            aria-label={`Move ${label}. Press space to pick up, then use the arrow keys.`}
            aria-pressed={isGrabbed}
            title="Drag to move, or press space and use the arrow keys"
            onPointerDown={(event) => onHandlePointerDown(event, item)}
            onPointerMove={onDragPointerMove}
            onPointerUp={onDragPointerUp}
            onPointerCancel={onDragPointerCancel}
            onKeyDown={(event) => onHandleKeyDown(event, item)}
            onClick={(event) => event.preventDefault()}
          >
            <span className="dash-drag-dots" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dash-size-toggle"
            data-testid="dash-size-toggle"
            aria-label={`Change the size of ${label} (now ${WIDGET_SIZE_LABEL[currentSize]})`}
            aria-expanded={selected}
            title="Change size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(selected ? null : item.i);
            }}
          >
            <span aria-hidden="true">{WIDGET_SIZE_LABEL[currentSize]}</span>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {hiddenNote ? (
            <p className="dash-hidden-note" data-testid="dash-hidden-note">
              {hiddenNote}
            </p>
          ) : null}
          <div
            className="dash-item-sizes"
            role="group"
            aria-label={`Resize ${label}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="dash-size-chips">
              {WIDGET_SIZE_KEYS.map((size) => (
                <button
                  key={size}
                  type="button"
                  className="dash-size-btn"
                  data-active={currentSize === size}
                  title={`${WIDGET_SIZE_LABEL[size]} widget`}
                  aria-label={`${label} size ${WIDGET_SIZE_LABEL[size]}`}
                  aria-pressed={currentSize === size}
                  onClick={() => {
                    onResize(item.i, size);
                    // Close once a size is picked: left open, the chips sat over the card's title
                    // and hid the change they had just made.
                    onSelect?.(null);
                  }}
                >
                  {WIDGET_SIZE_LABEL[size]}
                </button>
              ))}
              <button
                type="button"
                className="dash-size-btn dash-size-reset"
                data-testid="dash-reset-widget-size"
                disabled={atDefault}
                title={atDefault ? `${label} is already at its default size` : `Back to the default size`}
                aria-label={`Reset ${label} to its default size`}
                onClick={() => {
                  onResetSize(item.i);
                  onSelect?.(null);
                }}
              >
                Default
              </button>
              {onHideWhenEmpty && isAlwaysShown(item) ? (
                <button
                  type="button"
                  className="dash-size-btn dash-size-reset"
                  data-testid="dash-hide-when-empty"
                  aria-label={`Hide ${label} on Home when it has nothing to show`}
                  onClick={() => onHideWhenEmpty(item.i)}
                >
                  Hide when empty
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      {!editing ? <DashboardCardActions type={item.type} label={label} /> : null}
      <div className="dash-widget-hit">
        <DashboardWidgetView
          type={item.type}
          payload={payload}
          orgId={orgId}
          tbaConfigured={tbaConfigured}
          canOpenTeamData={canOpenTeamData}
        />
      </div>
    </article>
  );
});
