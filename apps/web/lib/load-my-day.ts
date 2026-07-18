/**
 * Thin alias so API / calendar call sites can import `loadMyDay`
 * while the loader lives in `my-day-load.ts`.
 */
export { loadMyDayView as loadMyDay } from "./my-day-load";
export type { MyDayView } from "./my-day";
