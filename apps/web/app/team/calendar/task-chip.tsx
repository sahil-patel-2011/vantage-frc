"use client";

import { useState } from "react";

import { isOverdue, type TaskOnCalendar } from "../../../lib/calendar/tasks-on-calendar";

/**
 * One team task, sitting on the calendar day it is due.
 *
 * The tick is the whole point. Seeing that the elevator wiring is due Thursday
 * is half of it; being able to mark it done from the same place is the other
 * half, and it is what stops the task list going stale the moment a build night
 * gets busy.
 *
 * Completing goes through /api/todos `update-todo`, the same call /todos makes,
 * so RLS, the notification to whoever assigned it, and completed_at/completed_by
 * are all handled by the one code path rather than a second copy of it here.
 */
export function TaskChip({
  task,
  today,
  orgId,
  onChanged,
}: {
  task: TaskOnCalendar;
  today: string;
  orgId: string;
  /** Called after a successful write so the calendar reloads its own view. */
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const late = isOverdue(task, today);

  async function complete() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update-todo", orgId, todoId: task.id, status: "done" }),
      });
      if (!response.ok) {
        // Leave the chip exactly as it was. A tick that silently un-ticks on the
        // next reload is worse than one that says it did not save.
        setFailed(true);
        return;
      }
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const detail = [
    task.assigneeName,
    task.subteamName,
    late ? "overdue" : null,
    task.status === "doing" ? "in progress" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={`tc-task-chip${late ? " is-late" : ""}${task.status === "doing" ? " is-doing" : ""}`}
      style={task.subteamColor ? { ["--tc-task-color" as string]: task.subteamColor } : undefined}
    >
      <button
        type="button"
        className="tc-task-tick"
        disabled={saving}
        aria-label={`Mark "${task.title}" done`}
        title={failed ? "Could not save — try again" : "Mark done"}
        onClick={() => void complete()}
      >
        {saving ? "…" : failed ? "!" : "✓"}
      </button>
      <a className="tc-task-title" href={`/todos?todoId=${encodeURIComponent(task.id)}`} title={detail || task.title}>
        {task.title}
      </a>
    </span>
  );
}

/** The day's tasks, or nothing at all — never an empty "0 tasks" row. */
export function DayTasks({
  tasks,
  today,
  orgId,
  onChanged,
  limit,
}: {
  tasks: readonly TaskOnCalendar[];
  today: string;
  orgId: string;
  onChanged: () => void;
  /** Month cells are small; overflow is counted rather than clipped silently. */
  limit?: number;
}) {
  if (tasks.length === 0) return null;
  const shown = limit == null ? tasks : tasks.slice(0, limit);
  const hidden = tasks.length - shown.length;
  return (
    <>
      {shown.map((task) => (
        <TaskChip key={task.id} task={task} today={today} orgId={orgId} onChanged={onChanged} />
      ))}
      {hidden > 0 ? <span className="tc-task-more">+{hidden} more due</span> : null}
    </>
  );
}
