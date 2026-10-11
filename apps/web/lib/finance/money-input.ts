/**
 * Reading an amount someone typed (or a script sent) without inventing money.
 *
 * `POST /api/costs` used to turn "-50", "abc" and "$1,200.50" into a $0.00 paid cost, and a
 * negative budget into "no budget" (A5-08). Now an amount is either a real number of dollars
 * and cents, or a sentence saying what to fix. "$1,200.50" is read as 1200.50: the dollar sign
 * and thousands commas are how people write money, not an error.
 */

import { formatUsd } from "./format-usd";

export type MoneyInput = { ok: true; value: number | null } | { ok: false; reason: string };

/** The largest amount any single money field accepts. */
export const MONEY_INPUT_MAX = 10_000_000;

export function parseMoneyInput(
  raw: unknown,
  options: {
    /** What the field is called in the sentence: "The amount", "The budget". */
    label?: string;
    /** An empty value means "none" (clearing a budget) instead of an error. */
    allowEmpty?: boolean;
    max?: number;
  } = {},
): MoneyInput {
  const label = options.label ?? "The amount";
  const max = options.max ?? MONEY_INPUT_MAX;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return options.allowEmpty ? { ok: true, value: null } : { ok: false, reason: `${label} is missing. Enter it in dollars, like 1200.50.` };
  }
  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const text = raw.trim().replace(/^\$\s*/, "").replace(/,(?=\d{3}(\D|$))/g, "");
    if (/^-/.test(text)) return { ok: false, reason: `${label} can't be negative.` };
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return { ok: false, reason: `${label} has to be a number of dollars, like 1200.50.` };
    value = Number(text);
  } else {
    return { ok: false, reason: `${label} has to be a number of dollars, like 1200.50.` };
  }
  if (!Number.isFinite(value)) return { ok: false, reason: `${label} has to be a number of dollars, like 1200.50.` };
  if (value < 0) return { ok: false, reason: `${label} can't be negative.` };
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return { ok: false, reason: `${label} can only go to the cent, like 12.34.` };
  if (value > max) return { ok: false, reason: `${label} is more than ${formatUsd(max)}. Check the number.` };
  return { ok: true, value: cents / 100 };
}
