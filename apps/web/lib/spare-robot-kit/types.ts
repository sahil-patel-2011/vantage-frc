// Spare-robot-kit domain types. Pure data shapes — no I/O, no framework imports.
// A kit checklist is a generated list of "what to physically pack in the spare-parts box for
// competition", derived by cross-referencing inventory spare bins against FMEA repeat-failure
// history for the matching subsystem. Nothing here is fabricated: an item only appears when it
// exists in inventory_items(category='spare') and has at least one matched fmea_failures row.

export type KitPriority = "critical" | "recommended" | "optional";

export type ChecklistStatus = "draft" | "finalized";

/** One inventory spare bin cross-referenced against FMEA failure history for its subsystem. */
export type KitChecklistItem = {
  itemId: string;
  itemName: string;
  category: string;
  subsystem: string | null;
  quantityOnHand: number;
  unitCost: number | null;
  failureCount: number;
  /** Average RPN (occurrence x severity x detection, each 1-10) across matched FMEA rows. */
  avgRpn: number;
  recommendedQty: number;
  priority: KitPriority;
  rationale: string;
  packed: boolean;
};

export type SpareRobotKitChecklist = {
  id: string;
  seasonYear: number;
  title: string;
  status: ChecklistStatus;
  items: KitChecklistItem[];
  rationale: string;
  createdAt: string;
  updatedAt: string;
};

/** Inventory spare bin read from the existing inventory_items table (read-only join). */
export type SpareKitBin = {
  id: string;
  name: string;
  category: string;
  subsystem: string | null;
  quantityOnHand: number;
  unitCost: number | null;
};

/** FMEA repeat-failure aggregate for a subsystem within the season, read from fmea_failures. */
export type SubsystemFailureAggregate = {
  subsystemName: string;
  failureCount: number;
  avgRpn: number;
};
