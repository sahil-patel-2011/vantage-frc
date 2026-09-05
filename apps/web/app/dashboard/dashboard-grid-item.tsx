"use client";

import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  WIDGET_SIZE_KEYS,
  WIDGET_SIZE_LABEL,
  type DashboardWidgetLayout,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { Icon } from "../../components/icon";
import { DashboardWidgetView } from "./widgets";

type Box = { left: number; top: number; width: number; height: number };

type DashboardGridItemProps = {
  item: DashboardWidgetLayout;
  box: Box;
  label: string;
  editing: boolean;
  isDragging: boolean;
  isGrabbed: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  currentSize: WidgetSizeKey;
  atDefault: boolean;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
  onCardPointerDown: (event: PointerEvent<HTMLElement>, item: DashboardWidgetLayout) => void;
  onHandlePointerDown: (event: PointerEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  onDragPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onDragPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onDragPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSizeKey) => void;
  onResetSize: (id: string) => void;
};

export const DashboardGridItem = memo(function DashboardGridItem({
  item,
  box,
  label,
  editing,
  isDragging,
  isGrabbed,
  isSelected,
  onSelect,
  currentSize,
  atDefault,
  payload,
  orgId,
  tbaConfigured,
  onCardPointerDown,
  onHandlePointerDown,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel,
  onHandleKeyDown,
  onRemove,
  onResize,
  onResetSize,
}: DashboardGridItemProps) {
  return (
    <article
      className={`dash-grid-item${editing ? " is-editing" : ""}${isDragging ? " is-dragging" : ""}${
        isGrabbed ? " is-grabbed" : ""
      }${editing && isSelected ? " is-selected" : ""}`}
      data-testid="dash-grid-item"
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
      onPointerDown={(event) => {
        if (editing) onSelect(item.i);
        onCardPointerDown(event, item);
      }}
      onFocusCapture={() => {
        if (editing) onSelect(item.i);
      }}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerUp}
      onPointerCancel={onDragPointerCancel}
    >
      {editing ? (
        <>
          <div className="dash-item-tools">
            <button
              type="button"
              className="dash-remove-btn"
              data-testid="dash-remove-widget"
              title="Remove widget"
              aria-label={`Remove ${label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove(item.i);
              }}
            >
              <Icon name="x" />
              <span>Remove</span>
            </button>
            <button
              type="button"
              className="dash-drag-handle dash-drag-surface"
              data-testid="dash-drag-handle"
              aria-label={`Move ${label}. Press space to pick up, then use the arrow keys.`}
              aria-pressed={isGrabbed}
              title="Drag to rearrange, or press space and use arrow keys"
              onPointerDown={(event) => onHandlePointerDown(event, item)}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              onPointerCancel={onDragPointerCancel}
              onKeyDown={(event) => onHandleKeyDown(event, item)}
              onClick={(event) => event.preventDefault()}
            >
              <span className="dash-drag-dots" aria-hidden="true" />
              <span className="dash-drag-label">{isGrabbed ? "Moving" : "Drag"}</span>
            </button>
          </div>
          {/* Sizes belong to the selected card only — every card showing S/M/L/XL
              plus Reset put 40 chips on an 8-widget board. */}
          <div
            className="dash-item-sizes"
            role="group"
            aria-label={`Resize ${label}`}
            hidden={!isSelected}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span aria-hidden="true">Size</span>
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
                title={atDefault ? `${label} is already at its default size` : `Reset ${label} to its default size`}
                aria-label={`Reset ${label} to its default size`}
                onClick={() => onResetSize(item.i)}
              >
                Reset
              </button>
            </div>
          </div>
        </>
      ) : null}
      {/* While arranging, a card is an object to move — following one of its links
          would navigate away and throw the unsaved layout out. */}
      <div className="dash-widget-hit" inert={editing}>
        <DashboardWidgetView type={item.type} payload={payload} orgId={orgId} tbaConfigured={tbaConfigured} />
      </div>
    </article>
  );
});
