"use client";
import { Button } from "../../components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultRobots,
  FIELD_H,
  FIELD_W,
  simplifyStroke,
  type RobotToken,
  type Stroke,
  type StrokeColor,
  type StrokeTool,
  type WhiteboardPlay,
  type WhiteboardView,
} from "../../lib/whiteboard";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

const COLOR_HEX: Record<StrokeColor, string> = {
  ink: "var(--app-ink)",
  red: "#d43a3a",
  blue: "#2f6fdd",
  green: "#1d9e5f",
  orange: "#e08a1e",
};

// ---------------------------------------------------------------------------
// Field canvas — pointer drawing + draggable robot tokens on an SVG.
// ---------------------------------------------------------------------------

function FieldCanvas({
  strokes,
  robots,
  tool,
  color,
  disabled,
  onStrokesChange,
  onRobotsChange,
}: {
  strokes: Stroke[];
  robots: RobotToken[];
  tool: StrokeTool | "erase" | "move";
  color: StrokeColor;
  disabled: boolean;
  onStrokesChange: (strokes: Stroke[]) => void;
  onRobotsChange: (robots: RobotToken[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const dragIdRef = useRef<RobotToken["id"] | null>(null);

  const toField = useCallback((event: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * FIELD_W;
    const y = ((event.clientY - rect.top) / rect.height) * FIELD_H;
    return [Math.max(0, Math.min(FIELD_W, x)), Math.max(0, Math.min(FIELD_H, y))];
  }, []);

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || tool === "move") return;
    const point = toField(event);
    if (!point) return;
    if (tool === "erase") return; // erasing handled per-stroke click
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDraft({ tool, color, points: [point, point] });
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toField(event);
    if (!point) return;
    if (dragIdRef.current) {
      const id = dragIdRef.current;
      onRobotsChange(robots.map((robot) => (robot.id === id ? { ...robot, x: Math.round(point[0]), y: Math.round(point[1]) } : robot)));
      return;
    }
    if (!draft) return;
    setDraft(
      draft.tool === "arrow"
        ? { ...draft, points: [draft.points[0]!, point] } // arrows are straight start→end
        : { ...draft, points: [...draft.points, point] },
    );
  };

  const finishStroke = () => {
    if (dragIdRef.current) {
      dragIdRef.current = null;
      return;
    }
    if (!draft) return;
    const points = draft.tool === "pen" ? simplifyStroke(draft.points) : draft.points;
    setDraft(null);
    if (points.length >= 2) onStrokesChange([...strokes, { ...draft, points }]);
  };

  const startRobotDrag = (event: React.PointerEvent, id: RobotToken["id"]) => {
    if (disabled) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragIdRef.current = id;
  };

  const renderStroke = (stroke: Stroke, index: number, isDraft = false) => {
    const hex = COLOR_HEX[stroke.color];
    const pathPoints = stroke.points.map((point) => point.join(",")).join(" ");
    const eraseProps =
      tool === "erase" && !isDraft
        ? {
            onClick: () => onStrokesChange(strokes.filter((_, i) => i !== index)),
            style: { cursor: "not-allowed" as const },
          }
        : {};
    if (stroke.tool === "arrow" && stroke.points.length >= 2) {
      const [x1, y1] = stroke.points[0]!;
      const [x2, y2] = stroke.points[stroke.points.length - 1]!;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 14;
      const left = [x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45)];
      const right = [x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45)];
      return (
        <g key={isDraft ? "draft" : index} {...eraseProps}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hex} strokeWidth={5} strokeLinecap="round" />
          <polygon points={`${x2},${y2} ${left.join(",")} ${right.join(",")}`} fill={hex} />
          {tool === "erase" && !isDraft ? (
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={22} />
          ) : null}
        </g>
      );
    }
    return (
      <g key={isDraft ? "draft" : index} {...eraseProps}>
        <polyline points={pathPoints} fill="none" stroke={hex} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        {tool === "erase" && !isDraft ? (
          <polyline points={pathPoints} fill="none" stroke="transparent" strokeWidth={22} />
        ) : null}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={`wb-field tool-${tool}`}
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
      role="img"
      aria-label="Strategy field canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerLeave={finishStroke}
    >
      {/* Schematic field: carpet, border, alliance zones, center line */}
      <rect x={0} y={0} width={FIELD_W} height={FIELD_H} rx={18} className="wb-carpet" />
      <rect x={4} y={4} width={FIELD_W - 8} height={FIELD_H - 8} rx={14} fill="none" className="wb-border" />
      <rect x={4} y={4} width={140} height={FIELD_H - 8} className="wb-zone red" />
      <rect x={FIELD_W - 144} y={4} width={140} height={FIELD_H - 8} className="wb-zone blue" />
      <line x1={FIELD_W / 2} y1={8} x2={FIELD_W / 2} y2={FIELD_H - 8} className="wb-centerline" />
      <circle cx={FIELD_W / 2} cy={FIELD_H / 2} r={54} fill="none" className="wb-centerline" />

      {strokes.map((stroke, index) => renderStroke(stroke, index))}
      {draft ? renderStroke(draft, -1, true) : null}

      {robots.map((robot) => (
        <g
          key={robot.id}
          className={`wb-robot ${robot.alliance}`}
          transform={`translate(${robot.x}, ${robot.y})`}
          onPointerDown={(event) => startRobotDrag(event, robot.id)}
        >
          <circle r={22} />
          <text textAnchor="middle" dominantBaseline="central">
            {robot.id.toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function WhiteboardClient() {
  const [view, setView] = useState<WhiteboardView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Local editing state for the selected play.
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [robots, setRobots] = useState<RobotToken[]>(defaultRobots());
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<StrokeTool | "erase" | "move">("pen");
  const [color, setColor] = useState<StrokeColor>("ink");
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/whiteboard${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as WhiteboardView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the whiteboard.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plays = view?.status === "ready" ? view.plays : [];
  const selected = plays.find((play) => play.id === selectedId) ?? plays[0] ?? null;

  // Sync editor state when switching plays (or after reload when clean).
  useEffect(() => {
    if (!selected) return;
    setStrokes(selected.strokes ?? []);
    setRobots(selected.robots?.length ? selected.robots : defaultRobots());
    setDirty(false);
  }, [selected?.id]);

  const run = useCallback(
    async (body: ActionBody) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/whiteboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string; id?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return null;
        }
        return data;
      } catch {
        setError("Network error — changes were not saved.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page wb-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Whiteboard</span>
            <h1>Strategy Whiteboard</h1>
          </div>
        </header>
        <div className="app-card wb-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
                classifyLoadFailure({
                  status: errorStatus,
                  message: error,
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                }),
                {
                  nextPath:
                    typeof window === "undefined"
                      ? null
                      : `${window.location.pathname}${window.location.search}`,
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <Button as="a" variant="primary" href={copy.primary.href}>
                      {copy.primary.label}
                    </Button>
                  ) : null}
                  {copy.showRetry ? (
                    <Button variant="secondary" type="button" onClick={() => void load()}>
                      Retry
                    </Button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading whiteboard…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page wb-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Whiteboard</span>
            <h1>Strategy Whiteboard</h1>
            <p>Draw plays over a field diagram and save them for match briefings.</p>
          </div>
        </header>
        <div className="app-card wb-empty">
          <strong>Select a team</strong>
          <p className="app-muted">{view.message}</p>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";

  const createPlay = async () => {
    const title = newTitle.trim() || `Play ${plays.length + 1}`;
    const result = await run({ action: "create_play", orgId, title });
    if (result?.id) {
      setNewTitle("");
      setSelectedId(result.id);
      await load();
    }
  };

  const savePlay = async () => {
    if (!selected) return;
    const result = await run({ action: "update_play", orgId, id: selected.id, strokes, robots });
    if (result) {
      setDirty(false);
      await load();
    }
  };

  const deletePlay = async (play: WhiteboardPlay) => {
    if (!confirm(`Delete play "${play.title}"?`)) return;
    const result = await run({ action: "delete_play", orgId, id: play.id });
    if (result) {
      if (selectedId === play.id) setSelectedId(null);
      await load();
    }
  };

  return (
    <main className="module-page wb-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Whiteboard</span>
          <h1>Strategy Whiteboard</h1>
          <p>
            Draw plays, drag the six robots, and save named strategies for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""}.
          </p>
        </div>
        <div className="wb-header-actions">
          <input
            value={newTitle}
            placeholder="New play name"
            disabled={busy}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createPlay();
            }}
          />
          <Button variant="primary" type="button" disabled={busy} onClick={() => void createPlay()}>
            New play
          </Button>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {plays.length === 0 ? (
        <div className="app-card wb-empty">
          <strong>No plays yet</strong>
          <p className="app-muted">Create your first play — draw routes with the pen, mark pushes with arrows, drag robots into position.</p>
          <Button variant="primary" type="button" disabled={busy} onClick={() => void createPlay()}>
            Create first play
          </Button>
        </div>
      ) : (
        <div className="wb-layout">
          <aside className="wb-list">
            {plays.map((play) => (
              <div key={play.id} className={play.id === selected?.id ? "wb-list-item active" : "wb-list-item"}>
                <button type="button" className="wb-list-select" onClick={() => setSelectedId(play.id)}>
                  <strong>{play.title}</strong>
                  <small>
                    {play.strokes.length} stroke{play.strokes.length === 1 ? "" : "s"}
                    {play.matchKey ? ` · ${play.matchKey}` : ""}
                  </small>
                </button>
                <button type="button" className="wb-link danger" disabled={busy} onClick={() => void deletePlay(play)}>
                  ✕
                </button>
              </div>
            ))}
          </aside>

          {selected ? (
            <section className="wb-editor app-card">
              <div className="wb-toolbar" role="toolbar" aria-label="Drawing tools">
                <div className="wb-tools">
                  {(["pen", "arrow", "erase", "move"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={tool === value ? "active" : undefined}
                      onClick={() => setTool(value)}
                    >
                      {value === "pen" ? "✏️ Pen" : value === "arrow" ? "→ Arrow" : value === "erase" ? "⌫ Erase" : "✥ Move"}
                    </button>
                  ))}
                </div>
                <div className="wb-colors" aria-label="Stroke color">
                  {(Object.keys(COLOR_HEX) as StrokeColor[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={color === value ? "wb-swatch active" : "wb-swatch"}
                      style={{ background: COLOR_HEX[value] }}
                      aria-label={`Color ${value}`}
                      onClick={() => setColor(value)}
                    />
                  ))}
                </div>
                <div className="wb-actions">
                  <button
                    type="button"
                    disabled={busy || strokes.length === 0}
                    onClick={() => {
                      setStrokes(strokes.slice(0, -1));
                      setDirty(true);
                    }}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    disabled={busy || (strokes.length === 0 && !dirty)}
                    onClick={() => {
                      setStrokes([]);
                      setRobots(defaultRobots());
                      setDirty(true);
                    }}
                  >
                    Clear
                  </button>
                  <Button variant="primary" size="sm" type="button" disabled={busy || !dirty} onClick={() => void savePlay()}>
                    {dirty ? "Save play" : "Saved"}
                  </Button>
                </div>
              </div>

              <FieldCanvas
                strokes={strokes}
                robots={robots}
                tool={tool}
                color={color}
                disabled={busy}
                onStrokesChange={(next) => {
                  setStrokes(next);
                  setDirty(true);
                }}
                onRobotsChange={(next) => {
                  setRobots(next);
                  setDirty(true);
                }}
              />
              <p className="app-muted wb-hint">
                Pen draws routes · Arrow marks a push/pass · Erase removes a stroke (click it) · Move drags robots. Red/blue
                circles are the six alliance robots.
              </p>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
