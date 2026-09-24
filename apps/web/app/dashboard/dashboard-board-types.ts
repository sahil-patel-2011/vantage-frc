import type {
  DashboardWidgetLayout,
  DashboardWidgetType,
  WidgetCatalogEntry,
} from "../../lib/dashboard/catalog";
import type { GridCell, PointerPoint } from "../../lib/dashboard/grid-drag";

export type Me = {
  userId?: string;
  name?: string;
  /** From the profile when set; /api/me sends it (null when the profile has none). */
  firstName?: string | null;
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

/** The pill over the board during a drag, in card words: "Moving Hours this month · after Next match". */
export type SnapFeedback = {
  mode: "Moving" | "Placing";
  label: string;
  where: string;
};

export type DragKind = "move" | "add";
/** immediate = the grip; longpress = a finger on a card or sheet row; intent = a mouse, which drags once it moves. */
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
  /** The picked-up card's content, copied into the ghost that follows the pointer. */
  sourceNode: HTMLElement | null;
  /** The order the preview last showed, so an unchanged plan is not re-applied. */
  orderKey?: string;
  /** Where the card goes, in card words ("after Next match"). */
  where?: string;
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
  /** For a card on the board: "On Home", or why Home is not showing it. */
  placedLabel?: string;
};
