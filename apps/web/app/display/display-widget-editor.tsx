"use client";

import { useState } from "react";
import { Button } from "../../components/ui";
import type { DisplayWidgetType } from "../../lib/display";
import {
  MAX_WIDGETS,
  MIN_WIDGETS,
  WIDGET_LABEL,
  addWidget,
  availableWidgets,
  layoutProblem,
  nudgeWidget,
  removeWidget,
  reorderWidgets,
} from "../../lib/display/widget-layout";

/**
 * Arranging the panels on a pit board.
 *
 * Order is not decoration on a screen across a pit: the top-left panel is the
 * one people read from six feet away, and every team wants a different one
 * there. A preset is where you start, not what you are stuck with.
 *
 * Reordering works three ways on purpose. Dragging is what most people reach
 * for; the up and down buttons are what works from a keyboard, from a screen
 * reader, and from a trackpad in a noisy pit where a long drag keeps getting
 * dropped. A drag-only reorder would be unusable for the last two, and this is
 * a page a mentor is often driving one-handed.
 */
export function DisplayWidgetEditor({
  widgets,
  onChange,
  disabled,
}: {
  widgets: DisplayWidgetType[];
  onChange: (next: DisplayWidgetType[]) => void;
  disabled?: boolean;
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const spare = availableWidgets(widgets);
  const problem = layoutProblem(widgets);

  function finishDrag(to: number | null) {
    if (draggingIndex != null && to != null) {
      onChange(reorderWidgets(widgets, draggingIndex, to));
    }
    setDraggingIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="dwe">
      <div className="dwe-head">
        <h3>Panels on this board</h3>
        <small>
          {widgets.length} of {MAX_WIDGETS} · the first panel is the one people read
          from across the pit
        </small>
      </div>

      <ol className="dwe-list">
        {widgets.map((type, index) => (
          <li
            key={type}
            className={`dwe-item${draggingIndex === index ? " dragging" : ""}${
              overIndex === index && draggingIndex !== index ? " over" : ""
            }`}
            draggable={!disabled}
            onDragStart={() => setDraggingIndex(index)}
            onDragOver={(event) => {
              event.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              finishDrag(index);
            }}
            onDragEnd={() => finishDrag(null)}
          >
            <span className="dwe-grip" aria-hidden="true">
              ⠿
            </span>
            <span className="dwe-position">{index + 1}</span>
            <span className="dwe-name">{WIDGET_LABEL[type]}</span>
            <span className="dwe-actions">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={disabled || index === 0}
                aria-label={`Move ${WIDGET_LABEL[type]} earlier`}
                onClick={() => onChange(nudgeWidget(widgets, type, "up"))}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={disabled || index === widgets.length - 1}
                aria-label={`Move ${WIDGET_LABEL[type]} later`}
                onClick={() => onChange(nudgeWidget(widgets, type, "down"))}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={disabled || widgets.length <= MIN_WIDGETS}
                aria-label={`Remove ${WIDGET_LABEL[type]}`}
                onClick={() => onChange(removeWidget(widgets, type))}
              >
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ol>

      {problem ? (
        <p className="dwe-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {spare.length ? (
        <div className="dwe-add">
          <span>Add a panel</span>
          <div className="dwe-add-buttons">
            {spare.map((type) => (
              <Button
                key={type}
                variant="secondary"
                size="sm"
                type="button"
                disabled={disabled || widgets.length >= MAX_WIDGETS}
                onClick={() => onChange(addWidget(widgets, type))}
              >
                {WIDGET_LABEL[type]}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="app-muted dwe-full">Every available panel is already on this board.</p>
      )}
    </div>
  );
}
