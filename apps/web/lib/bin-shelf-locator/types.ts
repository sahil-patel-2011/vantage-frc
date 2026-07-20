// Bin/Shelf Locator domain types. Pure data shapes — no I/O, no framework imports.
// Layered on top of the existing inventory_items catalog (packages/db/migrations/0037):
// a dedicated location registry (bin/shelf/zone codes + photo), a quantity-at-location join
// so an item can live in more than one bin, and an append-only move/put-away log.

export type BinShelfLocationKind = "bin" | "shelf" | "zone" | "cart" | "drawer" | "other";

export type BinShelfMoveMethod = "manual" | "scan" | "putaway" | "audit";

export type BinShelfLocation = {
  id: string;
  code: string;
  kind: BinShelfLocationKind;
  zone: string | null;
  photoUrl: string | null;
  notes: string;
  archived: boolean;
  itemCount: number;
  createdAt: string;
};

export type BinShelfItemLocation = {
  id: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  locationId: string;
  locationCode: string;
  locationKind: BinShelfLocationKind;
  quantity: number;
  lastSeenAt: string;
};

export type BinShelfMove = {
  id: string;
  itemId: string;
  itemName: string;
  fromLocationId: string | null;
  fromLocationCode: string | null;
  toLocationId: string | null;
  toLocationCode: string | null;
  quantity: number;
  method: BinShelfMoveMethod;
  note: string;
  movedBy: string;
  createdAt: string;
};

/** Minimal inventory item reference for the locator's item-picker / label generator. */
export type BinShelfInventoryItem = {
  id: string;
  name: string;
  category: string;
  partNumber: string | null;
  quantity: number;
};

/** Result of a scan-to-find lookup: everywhere a scanned item currently lives. */
export type BinShelfFindResult = {
  itemId: string;
  itemName: string;
  placements: BinShelfItemLocation[];
  recentMoves: BinShelfMove[];
};
