import { bucketFromTier, isPickBucket } from "./ordering";
import type { PickDeskEntry, PickDeskList } from "../strategy/pick-desk";

export type RankingTier = "first" | "second" | "watch" | "avoid";
export function rankingTier(entry: Pick<PickDeskEntry, "tier" | "bucket">): RankingTier {
  const bucket = isPickBucket(entry.bucket) ? entry.bucket : bucketFromTier(entry.tier);
  return bucket === "first_pick" ? "first" : bucket === "second_pick" ? "second" : bucket === "avoid" ? "avoid" : "watch";
}
export function rankingEntries(entries: PickDeskEntry[]): PickDeskEntry[] {
  return entries.map(entry => ({ ...entry, bucket: undefined, tier: rankingTier(entry) }));
}
export function rankingDocument(name: string, entries: PickDeskEntry[]): string {
  return JSON.stringify({ name: name.trim() || "Alliance picks", entries: entries.map(entry => ({
    teamKey: entry.teamKey, rank: entry.rank, tier: rankingTier(entry), notes: entry.notes ?? null,
  })) });
}
export function rankingIsDirty(saved: PickDeskList | undefined, name: string, entries: PickDeskEntry[]): boolean {
  return rankingDocument(name, entries) !== rankingDocument(saved?.name ?? "Alliance picks", saved?.entries ?? []);
}
export function confirmedRankingList(value: unknown, eventKey: string, expectedId?: string): value is PickDeskList {
  if (!value || typeof value !== "object") return false;
  const list = value as PickDeskList;
  return typeof list.id === "string" && !!list.id && (!expectedId || list.id === expectedId)
    && list.eventKey === eventKey && typeof list.name === "string" && !!list.name.trim()
    && typeof list.revision === "number" && Number.isSafeInteger(list.revision) && list.revision > 0
    && ["open", "locked", "archived"].includes(list.status ?? "")
    && Array.isArray(list.entries) && list.entries.length <= 500
    && list.entries.every(entry => entry && typeof entry.teamKey === "string" && /^frc[1-9]\d{0,6}$/.test(entry.teamKey)
      && Number.isSafeInteger(entry.rank) && entry.rank > 0 && entry.rank <= list.entries.length
      && (entry.notes == null || typeof entry.notes === "string"))
    && new Set(list.entries.map(entry => entry.teamKey)).size === list.entries.length
    && new Set(list.entries.map(entry => entry.rank)).size === list.entries.length;
}
