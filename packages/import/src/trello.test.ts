import { describe, expect, it } from "vitest";
import { ImportShapeError } from "./result";
import {
  readTrelloBoard,
  suggestListStatus,
  trelloCardsToTaskDrafts,
  trelloListStatusSuggestions,
} from "./trello";

/**
 * FIXTURE — the key/value shape of a real Trello "Export as JSON" board, keyed
 * exactly as the export writes them (id, name, desc, idList, closed, due,
 * dueComplete, idChecklists, pos, shortUrl on cards; checkItems with
 * "complete"/"incomplete" state on checklists). Content is a made-up build
 * board, which is what a Trello export of a robotics team would contain.
 */
const BOARD = JSON.stringify({
  id: "5fcbec03c670ab79e1f625b2",
  name: "Build Season",
  desc: "",
  closed: false,
  lists: [
    { id: "list_todo", name: "Todo", closed: false, pos: 65535, idBoard: "5fcbec03c670ab79e1f625b2" },
    { id: "list_doing", name: "Doing", closed: false, pos: 131070, idBoard: "5fcbec03c670ab79e1f625b2" },
    { id: "list_blocked", name: "Blocked", closed: false, pos: 196605, idBoard: "5fcbec03c670ab79e1f625b2" },
    { id: "list_done", name: "Done", closed: false, pos: 262140, idBoard: "5fcbec03c670ab79e1f625b2" },
  ],
  cards: [
    {
      id: "card_intake",
      name: "Design intake rollers",
      desc: "Compliant wheels, 2in spacing.",
      idList: "list_doing",
      closed: false,
      due: "2026-01-24T17:00:00.000Z",
      dueComplete: false,
      idChecklists: ["chk_intake"],
      pos: 32767.5,
      shortUrl: "https://trello.com/c/cQCFhToV",
    },
    {
      id: "card_wiring",
      name: "Wire the elevator",
      desc: "",
      idList: "list_todo",
      closed: false,
      due: null,
      dueComplete: false,
      idChecklists: [],
      pos: 65535,
      shortUrl: "https://trello.com/c/aB3dEfGh",
    },
    {
      id: "card_archived",
      name: "Old prototype",
      desc: "",
      idList: "list_done",
      closed: true,
      due: null,
      dueComplete: false,
      idChecklists: [],
      pos: 98302.5,
      shortUrl: "https://trello.com/c/zZ9yYxWv",
    },
    {
      id: "card_orphan",
      name: "Card from a deleted list",
      desc: "",
      idList: "list_gone",
      closed: false,
      due: null,
      idChecklists: [],
      pos: 131070,
    },
  ],
  checklists: [
    {
      id: "chk_intake",
      name: "Fab steps",
      idCard: "card_intake",
      pos: 16384,
      checkItems: [
        { id: "ci_1", name: "CAD the plates", state: "complete", pos: 17408, idChecklist: "chk_intake" },
        { id: "ci_2", name: "Cut on the router", state: "incomplete", pos: 34816, idChecklist: "chk_intake" },
      ],
    },
  ],
  labels: [],
  members: [],
  actions: [],
});

describe("readTrelloBoard", () => {
  it("reads lists, cards, and checklists", () => {
    const board = readTrelloBoard(BOARD);
    expect(board.name).toBe("Build Season");
    expect(board.lists).toHaveLength(4);
    expect(board.cards).toHaveLength(4);
    expect(board.checklists).toHaveLength(1);
  });

  it("rejects JSON that is not a board export, naming what was expected", () => {
    expect(() => readTrelloBoard(JSON.stringify({ tickets: [] }))).toThrow(ImportShapeError);
    try {
      readTrelloBoard(JSON.stringify({ tickets: [] }));
    } catch (error) {
      expect((error as Error).message).toContain("cards");
      expect((error as Error).message).toContain("Export as JSON");
    }
  });
});

describe("suggestListStatus", () => {
  it("suggests a status from the list name", () => {
    expect(suggestListStatus("Todo")).toBe("todo");
    expect(suggestListStatus("Doing")).toBe("in_progress");
    expect(suggestListStatus("In Progress")).toBe("in_progress");
    expect(suggestListStatus("Blocked")).toBe("blocked");
    expect(suggestListStatus("Done")).toBe("done");
    expect(suggestListStatus("Icebox")).toBe("archived");
    expect(suggestListStatus("Week 3 ideas")).toBe("todo");
  });

  it("reports a card count per list so the mapping UI can show volume", () => {
    expect(trelloListStatusSuggestions(readTrelloBoard(BOARD))).toEqual([
      { listId: "list_todo", listName: "Todo", suggested: "todo", cardCount: 1 },
      { listId: "list_doing", listName: "Doing", suggested: "in_progress", cardCount: 1 },
      { listId: "list_blocked", listName: "Blocked", suggested: "blocked", cardCount: 0 },
      { listId: "list_done", listName: "Done", suggested: "done", cardCount: 0 },
    ]);
  });
});

describe("trelloCardsToTaskDrafts", () => {
  const result = trelloCardsToTaskDrafts({
    content: BOARD,
    listStatus: { list_doing: "in_progress", list_todo: "todo", list_done: "done", list_blocked: "blocked" },
    sourceFile: "build-season.json",
    now: new Date("2026-01-10T00:00:00.000Z"),
  });

  it("imports the open cards on known lists", () => {
    expect(result.drafts.map((draft) => draft.title)).toEqual(["Design intake rollers", "Wire the elevator"]);
  });

  it("applies the reviewed list -> status mapping", () => {
    expect(result.drafts[0]!.payload.status).toBe("in_progress");
    expect(result.drafts[1]!.payload.status).toBe("todo");
  });

  it("preserves the due date as a date", () => {
    expect(result.drafts[0]!.payload.dueOn).toBe("2026-01-24");
    expect(result.drafts[1]!.payload.dueOn).toBeNull();
  });

  it("folds checklists into the body because tasks have no subtasks", () => {
    expect(result.drafts[0]!.body).toBe(
      "Compliant wheels, 2in spacing.\n\nFab steps:\n- [x] CAD the plates\n- [ ] Cut on the router",
    );
    expect(result.drafts[0]!.payload.checklistCount).toBe(2);
  });

  it("skips archived cards and cards whose list is not in the export", () => {
    const reasons = result.skipped.map((skip) => `${skip.ref}: ${skip.reason}`).join(" | ");
    expect(reasons).toMatch(/Old prototype: the card is archived in Trello/);
    expect(reasons).toMatch(/Card from a deleted list: .*is not in this export/);
  });

  it("keys on the Trello card id so re-importing changes nothing", () => {
    const again = trelloCardsToTaskDrafts({ content: BOARD, now: new Date("2026-06-01T00:00:00.000Z") });
    expect(again.drafts.map((draft) => draft.idempotencyKey)).toEqual([
      "trello:card_intake",
      "trello:card_wiring",
    ]);
    expect(again.drafts.map((draft) => draft.idempotencyKey)).toEqual(
      result.drafts.map((draft) => draft.idempotencyKey),
    );
  });

  it("falls back to the suggested status when no mapping is supplied", () => {
    const unmapped = trelloCardsToTaskDrafts({ content: BOARD });
    expect(unmapped.drafts[0]!.payload.status).toBe("in_progress");
  });

  it("can include archived cards on request", () => {
    const withClosed = trelloCardsToTaskDrafts({ content: BOARD, includeClosed: true });
    expect(withClosed.drafts.map((draft) => draft.title)).toContain("Old prototype");
  });
});
