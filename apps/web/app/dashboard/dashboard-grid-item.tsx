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
  /** Tapped or clicked in edit mode — its size controls stay out. */
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
  onSelect?: (id: string) => void;
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
  a grip tab on the top edge, and the sizes only on the card you are working on.
*/
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
      onClick={(event) => {
        if (!editing || !onSelect) return;
        if ((event.target as HTMLElement).closest("button")) return;
        onSelect(item.i);
      }}
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
            onFocus={() => onSelect?.(item.i)}
            onClick={(event) => event.preventDefault()}
          >
            <span className="dash-drag-dots" aria-hidden="true" />
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
                  onFocus={() => onSelect?.(item.i)}
                  onClick={() => onResize(item.i, size)}
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
                onClick={() => onResetSize(item.i)}
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
