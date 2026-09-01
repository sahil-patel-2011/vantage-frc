// BOM cost rollup domain types. Pure data shapes — no I/O, no framework imports.
// Tracks bill-of-materials line items (manually logged or exported from CAD) and rolls them up
// against a season budget target. Distinct from the weight/power budget reconciler — this is
// dollars, not mass or current.

export type BomCategory = "purchased" | "raw_material" | "fastener" | "electronics" | "other";

export type BomSource = "manual" | "cad_import";

export type BomStatus = "under" | "near" | "over";

export type BomLineItem = {
  id: string;
  partName: string;
  subsystem: string;
  category: BomCategory;
  quantity: number;
  unitCostUsd: number;
  lineTotalUsd: number;
  source: BomSource;
  cadReference: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

export type BomSubsystemRollup = {
  subsystem: string;
  totalUsd: number;
  itemCount: number;
};

export type BomCategoryRollup = {
  category: BomCategory;
  totalUsd: number;
  itemCount: number;
};

export type BomRollupSummary = {
  totalCostUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  /** committed / budget, or null when no season budget is set — never a DEMO %. */
  percentUsed: number | null;
  status: BomStatus;
  itemCount: number;
  bySubsystem: BomSubsystemRollup[];
  byCategory: BomCategoryRollup[];
};
