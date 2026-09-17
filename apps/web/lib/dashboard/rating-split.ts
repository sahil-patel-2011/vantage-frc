/**
 * The auto / teleop / endgame split behind the Competition snapshot bar.
 *
 * The same three numbers used to print as "8.5 / 31.8 / 14.6 — auto / teleop /
 * end", which is a row of digits a student has to decode. As proportions of one
 * bar you can see at a glance that teleop is carrying the robot.
 */

export type RatingPart = {
  id: "auto" | "teleop" | "endgame";
  label: string;
  value: number;
  /** Share of the bar, 0–1. */
  share: number;
};

export type RatingSplit = {
  parts: RatingPart[];
  total: number;
};

const LABELS: Record<RatingPart["id"], string> = {
  auto: "Auto",
  teleop: "Teleop",
  endgame: "End",
};

function usable(value: unknown): number | null {
  // Number(null) is 0 and Number("") is 0, so coercing first would turn a
  // missing component into a real zero and draw a bar for data nobody has.
  // Absent has to be rejected before any coercion.
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  // A negative rating component is not a width. Zero is real and kept.
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Build the bar, or null when it cannot be drawn honestly.
 *
 * Null when any part is missing, or when every part is zero — a bar with no
 * width would read as "we measured this and it is nothing", which is a
 * different claim from "we do not have this yet". The caller shows the empty
 * state instead.
 *
 * The total is the sum of the parts, not a separately reported figure, so the
 * number beside the bar always equals what the bar is showing.
 */
export function ratingSplit(input: {
  auto?: unknown;
  teleop?: unknown;
  endgame?: unknown;
}): RatingSplit | null {
  const auto = usable(input.auto);
  const teleop = usable(input.teleop);
  const endgame = usable(input.endgame);
  if (auto == null || teleop == null || endgame == null) return null;

  const total = auto + teleop + endgame;
  if (total <= 0) return null;

  const raw: Array<[RatingPart["id"], number]> = [
    ["auto", auto],
    ["teleop", teleop],
    ["endgame", endgame],
  ];
  return {
    total,
    parts: raw.map(([id, value]) => ({
      id,
      label: LABELS[id],
      value,
      share: value / total,
    })),
  };
}

/** Widths that always add to 100%, so the bar never leaves a sliver of track. */
export function splitWidths(split: RatingSplit): string[] {
  const pct = split.parts.map((part) => part.share * 100);
  const rounded = pct.map((value) => Math.round(value * 10) / 10);
  // Rounding three shares can drift off 100; the largest segment absorbs it
  // rather than every segment being slightly wrong.
  const drift = 100 - rounded.reduce((sum, value) => sum + value, 0);
  if (Math.abs(drift) > 0.001) {
    let largest = 0;
    for (let i = 1; i < rounded.length; i += 1) {
      if ((rounded[i] ?? 0) > (rounded[largest] ?? 0)) largest = i;
    }
    rounded[largest] = Math.round(((rounded[largest] ?? 0) + drift) * 10) / 10;
  }
  return rounded.map((value) => `${value}%`);
}

/** One decimal, or an em dash — never a rounded-to-zero "0". */
export function ratingValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}
