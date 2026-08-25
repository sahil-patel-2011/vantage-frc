/**
 * Trello board export JSON ("Show menu → More → Print, export, and share →
 * Export as JSON", or `GET /1/boards/{id}?fields=all&lists=all&cards=all`).
 *
 * Verified against a real exported board (wekan's checked-in
 * docs/Features/ImportExport/Trello/trello/trello-project100.json), whose top
 * level carries `id, name, desc, closed, actions, cards, labels, lists,
 * members, checklists, customFields, ...`, whose cards carry
 * `id, name, desc, idList, closed, due, dueComplete, idChecklists, pos,
 * shortUrl, labels`, and whose lists carry `id, name, closed, pos, idBoard`.
 *
 * Checklists are `{ id, name, idCard, checkItems: [{ name, state, pos }] }`
 * where `state` is "complete" | "incomplete".
 *
 * SUBTASKS: `build_tasks` (packages/db/migrations/0044_build_tasks.sql) has no
 * subtask table, so checklist items are folded into the task's notes rather
 * than dropped — the checklist is preserved as text with its checked state.
 */

import { provenanceNow, type ImportDraft } from "./provenance";
import {
  emptyResult,
  isRecord,
  parseJsonOrReject,
  rejectShape,
  type ImportResult,
} from "./result";

/** The Vantage `build_tasks.status` values a Trello list can be mapped onto. */
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TrelloList = { id: string; name: string; closed?: boolean; pos?: number };

export type TrelloCheckItem = { name?: string; state?: string; pos?: number };

export type TrelloChecklist = {
  id?: string;
  name?: string;
  idCard?: string;
  checkItems?: TrelloCheckItem[];
};

export type TrelloCard = {
  id: string;
  name?: string;
  desc?: string;
  idList?: string;
  closed?: boolean;
  due?: string | null;
  dueComplete?: boolean;
  shortUrl?: string;
  idChecklists?: string[];
};

export type TrelloBoard = {
  id?: string;
  name?: string;
  lists: TrelloList[];
  cards: TrelloCard[];
  checklists: TrelloChecklist[];
};

const EXPECTED =
  'a Trello board export JSON with "lists" and "cards" arrays ' +
  "(Trello board menu → More → Print, export, and share → Export as JSON).";

export function readTrelloBoard(content: string): TrelloBoard {
  const parsed = parseJsonOrReject(content, EXPECTED);
  if (!isRecord(parsed)) rejectShape("That JSON is not an object.", EXPECTED);
  if (!Array.isArray(parsed.cards) || !Array.isArray(parsed.lists)) {
    const keys = Object.keys(parsed).slice(0, 10).join(", ") || "(none)";
    rejectShape(
      `That JSON has no "cards" and "lists" arrays (top-level keys: ${keys}).`,
      EXPECTED,
    );
  }
  const lists = (parsed.lists as unknown[]).filter(isRecord).map((list) => ({
    id: String(list.id ?? ""),
    name: typeof list.name === "string" ? list.name : "",
    closed: list.closed === true,
    pos: typeof list.pos === "number" ? list.pos : undefined,
  }));
  const cards = (parsed.cards as unknown[]).filter(isRecord).map((card) => card as TrelloCard);
  const checklists = Array.isArray(parsed.checklists)
    ? (parsed.checklists as unknown[]).filter(isRecord).map((entry) => entry as TrelloChecklist)
    : [];
  return {
    id: typeof parsed.id === "string" ? parsed.id : undefined,
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    lists,
    cards,
    checklists,
  };
}

/**
 * A first guess at list -> status, shown in the mapping UI for the user to
 * correct. It is a SUGGESTION: nothing commits on this alone.
 */
export function suggestListStatus(listName: string): TaskStatus {
  const name = listName.toLowerCase();
  if (/\b(done|complete|completed|shipped|finished|closed)\b/.test(name)) return "done";
  if (/\b(doing|in progress|in-progress|wip|active|started)\b/.test(name)) return "in_progress";
  if (/\b(blocked|blocker|waiting|on hold|stuck)\b/.test(name)) return "blocked";
  if (/\b(archive|archived|icebox|someday)\b/.test(name)) return "archived";
  return "todo";
}

/** The list-name → status choices the /migrate mapping UI renders. */
export function trelloListStatusSuggestions(
  board: TrelloBoard,
): Array<{ listId: string; listName: string; suggested: TaskStatus; cardCount: number }> {
  const counts = new Map<string, number>();
  for (const card of board.cards) {
    if (card.closed) continue;
    const key = String(card.idList ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return board.lists.map((list) => ({
    listId: list.id,
    listName: list.name,
    suggested: suggestListStatus(list.name),
    cardCount: counts.get(list.id) ?? 0,
  }));
}

function checklistNotes(checklists: TrelloChecklist[]): string {
  const blocks: string[] = [];
  for (const checklist of checklists) {
    const items = (checklist.checkItems ?? [])
      .slice()
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((item) => `- [${item.state === "complete" ? "x" : " "}] ${item.name ?? ""}`.trimEnd());
    if (!items.length) continue;
    blocks.push([`${checklist.name || "Checklist"}:`, ...items].join("\n"));
  }
  return blocks.join("\n\n");
}

export type TrelloImportInput = {
  content: string;
  /** listId -> status, from the mapping UI. Unmapped lists fall back to the suggestion. */
  listStatus?: Record<string, TaskStatus>;
  /** Import cards Trello has archived. Off by default. */
  includeClosed?: boolean;
  sourceFile?: string;
  now?: Date;
};

export type TrelloTaskDraft = ImportDraft & {
  kind: "task";
  idempotencyKey: string;
  payload: {
    status: TaskStatus;
    listName: string;
    dueOn: string | null;
    subsystem: string;
    checklistCount: number;
  };
};

/**
 * Trello cards -> task drafts. Due dates are preserved as a date; checklists
 * are folded into the body because Vantage tasks have no subtasks.
 */
export function trelloCardsToTaskDrafts(
  input: TrelloImportInput,
): ImportResult<TrelloTaskDraft> {
  const result = emptyResult<TrelloTaskDraft>();
  const board = readTrelloBoard(input.content);
  const now = input.now ?? new Date();

  const listById = new Map(board.lists.map((list) => [list.id, list]));
  const checklistsByCard = new Map<string, TrelloChecklist[]>();
  for (const checklist of board.checklists) {
    const cardId = String(checklist.idCard ?? "");
    if (!cardId) continue;
    const bucket = checklistsByCard.get(cardId) ?? [];
    bucket.push(checklist);
    checklistsByCard.set(cardId, bucket);
  }

  const seen = new Set<string>();

  board.cards.forEach((card, index) => {
    const ref = card.name?.trim() || card.id || `card ${index + 1}`;
    const title = (card.name ?? "").trim();
    if (!title) {
      result.skipped.push({ ref, reason: "the card has no name, so there is no task title to import" });
      return;
    }
    if (card.closed && !input.includeClosed) {
      result.skipped.push({ ref, reason: "the card is archived in Trello" });
      return;
    }
    const list = listById.get(String(card.idList ?? ""));
    if (!list) {
      result.skipped.push({
        ref,
        reason: `the card's list (${String(card.idList ?? "none")}) is not in this export, so its status cannot be mapped`,
      });
      return;
    }
    const cardId = String(card.id ?? "");
    if (!cardId) {
      result.skipped.push({ ref, reason: "the card has no id, so re-importing could not dedupe it" });
      return;
    }
    if (seen.has(cardId)) {
      result.skipped.push({ ref, reason: "duplicate card id in this export" });
      return;
    }
    seen.add(cardId);

    const status = input.listStatus?.[list.id] ?? suggestListStatus(list.name);
    const cardChecklists = checklistsByCard.get(cardId) ?? [];
    const notes = checklistNotes(cardChecklists);
    const body = [(card.desc ?? "").trim(), notes].filter(Boolean).join("\n\n");

    let dueOn: string | null = null;
    if (typeof card.due === "string" && card.due) {
      const parsed = new Date(card.due);
      if (Number.isNaN(parsed.getTime())) {
        result.skipped.push({ ref, reason: `the card's due date "${card.due}" could not be read, so no due date was set` });
      } else {
        dueOn = parsed.toISOString().slice(0, 10);
      }
    }

    result.drafts.push({
      kind: "task",
      title,
      body,
      ...(dueOn ? { startsAt: `${dueOn}T00:00:00.000Z` } : {}),
      idempotencyKey: `trello:${cardId}`,
      payload: {
        status,
        listName: list.name,
        dueOn,
        subsystem: "imported",
        checklistCount: cardChecklists.reduce((total, entry) => total + (entry.checkItems?.length ?? 0), 0),
      },
      provenance: provenanceNow(
        "trello",
        {
          sourceId: cardId,
          sourceFile: input.sourceFile,
          sourceUrl: typeof card.shortUrl === "string" ? card.shortUrl : undefined,
        },
        now,
      ),
    });
  });

  return result;
}
