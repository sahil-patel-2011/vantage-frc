// Consumables / Spares domain types. Pure data shapes — no I/O.
// Shop consumables (fasteners, wire, tape, rivets, PPE) with on-hand counts and reorder points.
// The app flags what needs reordering. Org-scoped and persistent across seasons.

export type ConsumableCategory =
  | "fasteners"
  | "electrical"
  | "pneumatics"
  | "adhesives"
  | "stock"
  | "tools"
  | "ppe"
  | "other";

export type Consumable = {
  id: string;
  name: string;
  category: ConsumableCategory;
  /** Unit of measure — "each", "ft", "roll", … */
  unit: string;
  onHand: number;
  /** Reorder when on-hand drops to this or below; 0 means "only when out". */
  reorderPoint: number;
  preferredVendor: string | null;
  notes: string | null;
  /**
   * Held as a competition spare as well as shop stock (migration 0520).
   * Marking a consumable here is what puts it in Spare Forecast — before 0520
   * that forecast read `category = 'spare'`, a *parts* category no consumable
   * can have, so /spares and /spare-forecast could never share a row.
   */
  isSpare: boolean;
};

export type ConsumableStatus = "ok" | "low" | "out";

export type ConsumableEvaluation = {
  item: Consumable;
  status: ConsumableStatus;
  needsReorder: boolean;
};

export type SparesSummary = {
  total: number;
  ok: number;
  low: number;
  out: number;
  byCategory: Array<{ category: ConsumableCategory; total: number; needsReorder: number }>;
  /** Items needing a reorder, most urgent first. */
  reorderList: ConsumableEvaluation[];
};
