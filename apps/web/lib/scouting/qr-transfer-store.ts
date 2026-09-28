"use client";
import { addScoutQrPart, completeScoutQrTransfer, decodeScoutQrPart, SCOUT_QR_PART_PREFIX, type ScoutQrAssembly } from "@vantage/scouting/qr-transfer";
import { assertScoutStorageUser, idbValue, requireScoutStorageUser, scoutTransaction } from "./personal-store";

const prefix = (orgId: string) => `qr-transfer:${orgId}:`;
type Stored = { key: string; assembly: ScoutQrAssembly };

/** Incomplete parts survive a reload in the receiving person's organization.
 * They cannot become scouting records until every part and the digest pass. */
export async function receiveScoutQrPart(content: string, orgId: string) {
  const codes = content.trim().startsWith(SCOUT_QR_PART_PREFIX)
    ? content.trim().split(/\r?\n/).map(code => code.trim()).filter(Boolean) : [content];
  if (codes.length > 256) throw new Error("Paste no more than 256 QR parts at a time.");
  const parts = codes.map(decodeScoutQrPart);
  const part = parts[0];
  if (!part) return { content, transferId: null, received: 0, total: 0 };
  if (parts.some(row => !row || row.id !== part.id || row.total !== part.total)) throw new Error("These codes belong to different transfers.");
  const user = await requireScoutStorageUser(orgId);
  await assertScoutStorageUser(user, orgId);
  const key = prefix(orgId) + part.id;
  const assembly = await scoutTransaction(user, "meta", "readwrite", async tx => {
    const store = tx.objectStore("meta");
    const previous = await idbValue<Stored | undefined>(store.get(key));
    if (!previous) {
      const rows = await idbValue<Array<{ key: string }>>(store.getAll());
      if (rows.filter(row => row.key.startsWith(prefix(orgId))).length >= 16) {
        throw new Error("Finish an incomplete QR transfer before starting another on this device.");
      }
    }
    let next = previous?.assembly ?? null;
    for (const row of parts) next = addScoutQrPart(next, row!);
    if (!next) throw new Error("No QR parts were found.");
    await idbValue(store.put({ key, assembly: next } satisfies Stored));
    return next;
  });
  await assertScoutStorageUser(user, orgId);
  return { content: await completeScoutQrTransfer(assembly), transferId: part.id,
    received: Object.keys(assembly.parts).length, total: assembly.total };
}

/** Delete only temporary parts after the ordinary authorized outbox merge has
 * committed. A failed merge retains them so the last code can be scanned again. */
export async function finishScoutQrTransfer(orgId: string, id: string): Promise<void> {
  const user = await requireScoutStorageUser(orgId);
  await assertScoutStorageUser(user, orgId);
  await scoutTransaction(user, "meta", "readwrite", async tx => {
    await idbValue(tx.objectStore("meta").delete(prefix(orgId) + id));
  });
}
