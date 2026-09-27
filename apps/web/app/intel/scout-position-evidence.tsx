"use client";
import {
  fieldPositionConfig,
  fieldPositionCellLabel,
  normalizeAutoPath,
  normalizeFieldPositionCells,
  type FieldDefinition,
} from "@vantage/scouting";

/** Uses the form's own grid. It does not infer a season field or autonomous route. */
export function ScoutPositionEvidence({
  field,
  value,
}: {
  field: FieldDefinition;
  value: unknown;
}) {
  const config = fieldPositionConfig(field);
  const path = field.type === "auto_path";
  const cells = path
    ? normalizeAutoPath(value, config)
    : normalizeFieldPositionCells(
        Array.isArray(value) ? value : [value],
        config,
      );
  const labels = cells.map((cell) => fieldPositionCellLabel(cell, config));
  if (!cells.length) return <span>No position recorded</span>;
  const x = (cell: number) => (cell % config.gridCols) * 32 + 16;
  const y = (cell: number) => Math.floor(cell / config.gridCols) * 32 + 16;
  return (
    <figure className="intel-position-evidence">
      <svg
        viewBox={"0 0 " + config.gridCols * 32 + " " + config.gridRows * 32}
        role="img"
        aria-label={field.label + ": " + labels.join(path ? " then " : ", ")}
      >
        {Array.from(
          { length: config.gridCols * config.gridRows },
          (_, cell) => (
            <rect
              key={cell}
              x={x(cell) - 15}
              y={y(cell) - 15}
              width={30}
              height={30}
              rx={4}
              fill={cells.includes(cell) ? "var(--accent)" : "var(--bg)"}
              opacity={cells.includes(cell) ? 0.18 : 1}
              stroke="var(--line)"
            />
          ),
        )}
        {path ? (
          <polyline
            points={cells.map((cell) => x(cell) + "," + y(cell)).join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        ) : null}
        {cells.map((cell, index) => (
          <g key={cell + ":" + index}>
            <circle cx={x(cell)} cy={y(cell)} r={9} fill="var(--accent)" />
            <text
              x={x(cell)}
              y={y(cell) + 3.5}
              textAnchor="middle"
              fontSize={10}
              fill="var(--accent-ink,#fff)"
            >
              {path ? index + 1 : "•"}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        {labels.join(path ? " → " : ", ")} · {config.gridCols} ×{" "}
        {config.gridRows} form grid
      </figcaption>
    </figure>
  );
}
