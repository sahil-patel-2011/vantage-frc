export * from "./types";
export {
  BIN_SHELF_LOCATION_KINDS,
  BIN_SHELF_MOVE_METHODS,
  archiveLocation,
  computeBinShelfLocatorView,
  createLocation,
  findItemLocations,
  recordMove,
  recordSighting,
  type BinShelfLocatorSetupStep,
  type BinShelfLocatorView,
} from "./compute-bin-shelf-locator";

export function binShelfLocationKindLabel(kind: string): string {
  switch (kind) {
    case "bin":
      return "Bin";
    case "shelf":
      return "Shelf";
    case "zone":
      return "Zone";
    case "cart":
      return "Cart";
    case "drawer":
      return "Drawer";
    default:
      return "Other";
  }
}

/** Encodes an item+location pair into a compact QR payload the scan-to-find page can parse. */
export function encodeLocatorPayload(kind: "item" | "location", id: string): string {
  return `vantage:bin-shelf-locator:${kind}:${id}`;
}

export function decodeLocatorPayload(raw: string): { kind: "item" | "location"; id: string } | null {
  const match = raw.trim().match(/^vantage:bin-shelf-locator:(item|location):([0-9a-fA-F-]{36})$/);
  if (!match) return null;
  const kind = match[1];
  const id = match[2];
  if (kind !== "item" && kind !== "location") return null;
  if (!id) return null;
  return { kind, id };
}
