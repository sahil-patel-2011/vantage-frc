import type { PicklistCollabView } from "./compute-picklist-collab";
import type { PicklistCollabTier } from "./types";
export type CollabLiveView = Extract<PicklistCollabView, { status: "live" }>;
export type CollabMutate = (payload: Record<string, unknown>) => Promise<boolean>;
const tiers: PicklistCollabTier[] = ["first_pick", "second_pick", "unranked", "avoid"];
const nullableText = (value: unknown) => value === null || typeof value === "string";
const nullableNumber = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function isCollabView(value: unknown, orgId?: string | null, listId?: string | null): value is PicklistCollabView {
  if (!value || typeof value !== "object") return false;
  const view = value as PicklistCollabView;
  if (orgId && view.orgId !== orgId) return false;
  if (view.status === "setup_required") return !listId && nullableText(view.orgId) && typeof view.message === "string"
    && Array.isArray(view.steps) && view.steps.every(step => step && typeof step.id === "string" && typeof step.label === "string" && typeof step.detail === "string" && typeof step.href === "string");
  return view.status === "live" && typeof view.orgId === "string"
    && Array.isArray(view.lists) && view.lists.every(list => list && typeof list.id === "string" && typeof list.name === "string")
    && (!listId || view.activeList?.id === listId) && Boolean(view.summary)
    && [view.summary.totalEntries, view.summary.totalVotes, view.summary.totalVoters].every(count => Number.isSafeInteger(count) && count >= 0)
    && (view.canManage === undefined || typeof view.canManage === "boolean")
    && (view.currentUserId === undefined || typeof view.currentUserId === "string")
    && (view.fieldStats === undefined || (record(view.fieldStats) && Object.values(view.fieldStats).every(stat => record(stat)
      && typeof stat.mean === "number" && Number.isFinite(stat.mean) && typeof stat.std === "number" && Number.isFinite(stat.std) && stat.std >= 0
      && Number.isSafeInteger(stat.n) && Number(stat.n) > 0)))
    && (view.eventTeams === undefined || (Array.isArray(view.eventTeams) && view.eventTeams.every(team => team && typeof team.teamKey === "string"
      && record(team.values) && Object.values(team.values).every(value => value === undefined || nullableNumber(value)))))
    && (view.activeList === null || (view.activeList && typeof view.activeList.id === "string" && typeof view.activeList.name === "string"
      && typeof view.activeList.eventKey === "string" && ["open", "locked", "archived"].includes(view.activeList.status)))
    && Array.isArray(view.entries) && view.entries.every(entry => entry && typeof entry.id === "string"
      && Number.isSafeInteger(entry.teamNumber) && entry.teamNumber > 0 && tiers.includes(entry.tier)
      && Number.isSafeInteger(entry.position) && entry.position > 0
      && nullableText(entry.teamName) && nullableText(entry.note) && Number.isFinite(entry.weightedScore) && nullableNumber(entry.averageRankSuggestion)
      && Array.isArray(entry.votes) && entry.votes.every(vote => vote && typeof vote.id === "string" && typeof vote.voterId === "string"
        && Number.isFinite(vote.weight) && vote.weight > 0 && nullableNumber(vote.rankSuggestion) && nullableText(vote.comment)));
}

/** A successful HTTP status alone does not prove that the requested team/list/vote changed. */
export function confirmsCollabMutation(view: CollabLiveView, payload: Record<string, unknown>, previous: PicklistCollabView | null): boolean {
  const list = view.activeList;
  if (!list || !Number.isSafeInteger(list.revision) || (list.revision ?? 0) < 1 || typeof view.currentUserId !== "string") return false;
  if (payload.action === "create-list") return list.name === String(payload.name).trim() && (!payload.eventKey || list.eventKey === payload.eventKey);
  if (previous?.status !== "live" || list.id !== previous.activeList?.id || (list.revision ?? 0) <= (previous.activeList?.revision ?? 0)) return false;
  if (previous.currentUserId && view.currentUserId !== previous.currentUserId) return false;
  const entry = view.entries.find(item => item.id === payload.entryId);
  switch (payload.action) {
    case "update-list-status": return list.status === payload.status;
    case "add-entry": return view.entries.some(item => item.teamNumber === payload.teamNumber && item.tier === (payload.tier ?? "unranked"));
    case "delete-entry": return !entry;
    case "set-entry-notes": return Boolean(entry && entry.note === payload.note);
    case "move-entry": return entry?.tier === payload.tier && view.entries.filter(item => item.tier === payload.tier)
      .sort((a, b) => a.position - b.position).findIndex(item => item.id === payload.entryId) === Number(payload.position) - 1;
    case "cast-vote": {
      const vote = entry?.votes.find(item => item.voterId === view.currentUserId);
      return Boolean(vote && vote.weight === (payload.weight ?? 1) && vote.rankSuggestion === (payload.rankSuggestion ?? null) && vote.comment === (payload.comment ?? null));
    }
    case "remove-vote": return Boolean(entry && !entry.votes.some(item => item.voterId === view.currentUserId));
    case "set-order": {
      if (!Array.isArray(payload.order)) return false;
      return payload.order.every((group: { tier: PicklistCollabTier; entryIds: string[] }) => {
        if (!group || !tiers.includes(group.tier) || !Array.isArray(group.entryIds)) return false;
        const actual = view.entries.filter(item => item.tier === group.tier).sort((a, b) => a.position - b.position).map(item => item.id);
        return group.entryIds.every((id, index) => actual[index] === id);
      });
    }
    default: return false;
  }
}
