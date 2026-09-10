import type {
  DashboardWidgetLayout,
  DashboardWidgetType,
  WidgetCatalogEntry,
} from "../../lib/dashboard/catalog";
import type { GridCell, PointerPoint } from "../../lib/dashboard/grid-drag";

export type Me = {
  userId?: string;
  name?: string;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  teamRole?: string | null;
  tbaConfigured?: boolean;
};

export type BoardMeta = {
  id: string;
  name: string;
  scope: "personal" | "org";
  isActive: boolean;
  updatedAt?: string | null;
  ownerUserId?: string | null;
};

export type BoardState = {
  id: string | null;
  name: string;
  scope: "personal" | "org";
  layout: DashboardWidgetLayout[];
  isDefault?: boolean;
};

export type SnapFeedback = {
  mode: "Moving" | "Placing";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DragKind = "move" | "add";
/** immediate = dedicated handle; longpress = card body / touch; intent = mouse on the palette. */
export type DragActivation = "immediate" | "longpress" | "intent";

export type DragSession = {
  kind: DragKind;
  id: string;
  type: DashboardWidgetType;
  label: string;
  pointerId: number;
  captureTarget: Element | null;
  activation: DragActivation;
  active: boolean;
  origin: PointerPoint;
  point: PointerPoint;
  grab: PointerPoint;
  size: { width: number; height: number };
  span: { w: number; h: number };
  cell: GridCell;
  cols: number;
  rowHeight: number;
  gap: number;
  baseLayout: DashboardWidgetLayout[];
  baseDisplay: DashboardWidgetLayout[];
};

export type DragView = {
  kind: DragKind;
  id: string;
  type: DashboardWidgetType;
  label: string;
  cell: GridCell;
  span: { w: number; h: number };
  size: { width: number; height: number };
};

export type PaletteStatus = "add" | "placed" | "locked";

export type PaletteRow = {
  entry: WidgetCatalogEntry;
  status: PaletteStatus;
  reason: string | null;
};
