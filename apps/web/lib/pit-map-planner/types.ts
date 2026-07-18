// Pit Map Planner domain types. Pure data shapes — no I/O, no framework imports.
// A layout describes the pit footprint (width/depth/power budget) for a season; items are
// the workstations, tool stations, power drops, storage, robot cart, charging, and safety
// gear placed within that footprint, positioned to scale so a printable map can be produced.

export type PitMapItemCategory =
  | "workstation"
  | "tool_station"
  | "power_drop"
  | "storage"
  | "robot_cart"
  | "charging"
  | "safety"
  | "other";

export type PitMapItem = {
  id: string;
  name: string;
  category: PitMapItemCategory;
  xFt: number;
  yFt: number;
  widthFt: number;
  depthFt: number;
  powerDrawAmps: number;
  notes: string | null;
  createdAt: string;
};

export type PitMapLayout = {
  footprintWidthFt: number;
  footprintDepthFt: number;
  powerCapacityAmps: number;
  notes: string | null;
  updatedAt: string;
};

export type PitMapCategoryBreakdown = {
  category: PitMapItemCategory;
  count: number;
  areaSqFt: number;
  powerDrawAmps: number;
};

export type PitMapSummary = {
  totalItems: number;
  footprintAreaSqFt: number;
  usedAreaSqFt: number;
  /** 0..1 share of the footprint area covered by placed items. */
  areaUtilization: number;
  totalPowerDrawAmps: number;
  /** 0..1 share of the power budget drawn by placed items (0 when no budget is set). */
  powerUtilization: number;
  overCapacity: boolean;
  byCategory: PitMapCategoryBreakdown[];
};
