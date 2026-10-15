import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonBody } from "../../../../lib/team-lessons/types";
import { DELETE, GET, PATCH, POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));

const orgId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };

const body: LessonBody = {
  steps: [{ id: "s-1", title: "Breakers", text: "Use 40 A breakers for drive motors." }],
  practice: [
    { id: "q-1", kind: "choice", prompt: "Drive motor breaker?", options: ["20 A", "40 A"], answer: 1 },
    { id: "q-2", kind: "text", prompt: "What powers the robot?", accepted: ["Battery", "the battery"] },
  ],
};

let role = "scout";
let lesson: Record<string, unknown>;
const lessonRow = (overrides: Record<string, unknown> = {}) => ({
  id,
  orgId,
  title: "Wiring",
  summary: "",
  audience: "",
  minutes: null,
  status: "published",
  source: "editor",
  body,
  pdfFileId: null,
  pdfFileName: null,
  version: 4,
  createdBy: "author",
  createdByName: "Ada",
  updatedAt: "2026-10-11T10:00:00Z",
  updatedByName: "Ada",
  publishedAt: "2026-10-11T10:00:00Z",
  ...overrides,
});

const sqlCalls = () => fake.query.mock.calls.map(([sql]) => String(sql));

beforeEach(() => {
  vi.resetAllMocks();
  role = "scout";
  lesson = lessonRow();
  fake.session.mockResolvedValue({ user: { id: "member" } });
  fake.withRls.mockImplementation(async (_context, work) => work({ query: fake.query }));
  fake.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM memberships")) return { rows: [{ role }], rowCount: 1 };
    if (sql.includes("FROM team_lessons l")) {
      // FOR UPDATE sees only rows this person may edit (0717's UPDATE policy).
      const editable = role === "owner" || role === "admin" || (lesson.createdBy === "member" && lesson.status === "draft");
      if (sql.includes("FOR UPDATE") && !editable) return { rows: [], rowCount: 0 };
      return { rows: [lesson], rowCount: 1 };
    }
    if (sql.includes("FROM team_lesson_attempts")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM team_lesson_revisions r")) return { rows: [{ id: "rev", version: 3, title: "Wiring", savedAt: "x", savedByName: "Ada" }], rowCount: 1 };
    if (sql.includes("INSERT INTO team_lesson_revisions") || sql.includes("DELETE FROM team_lesson_revisions")) return { rows: [], rowCount: 1 };
    if (sql.includes("UPDATE team_lessons")) return { rows: [{ version: Number(lesson.version) + 1, updatedAt: "2026-10-11T12:00:00Z" }], rowCount: 1 };
    if (sql.includes("INSERT INTO team_lesson_attempts")) {
      return { rows: [{ id: "attempt", score: params[4], total: params[5], passed: params[6], createdAt: "2026-10-11T12:00:00Z" }], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM team_lessons")) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  });
});

const json = (method: string, payload: unknown) =>
  new Request(`https://vantage.example/api/team-lessons/${id}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("GET /api/team-lessons/[id]", () => {
  it("strips answers for someone who cannot edit the lesson", async () => {
    const response = await GET(new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}`), context);
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.lesson.editor).toBe(false);
    expect(view.revisions).toEqual([]);
    const practice = JSON.stringify(view.lesson.body.practice);
    expect(practice).not.toMatch(/"answer"|accepted|Battery/);
    expect(view.lesson.body.practice).toHaveLength(2);
  });

  it("gives an editor the answers, and the history only when the editor asks for it", async () => {
    role = "admin";
    const view = await (await GET(new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}`), context)).json();
    expect(view.lesson.editor).toBe(true);
    expect(view.lesson.body.practice[0].answer).toBe(1);
    expect(view.revisions).toEqual([]);
    expect(sqlCalls().some((sql) => sql.includes("team_lesson_revisions"))).toBe(false);

    fake.query.mockClear();
    const editor = await (await GET(new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}&part=editor`), context)).json();
    expect(editor.revisions).toHaveLength(1);
    expect(editor.attempts).toEqual([]);
    expect(sqlCalls().some((sql) => sql.includes("FROM team_lesson_attempts"))).toBe(false);
  });

  it("returns only the history with part=revisions, and only to someone who may edit", async () => {
    const request = () => new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}&part=revisions`);
    expect((await GET(request(), context)).status).toBe(403);
    expect(sqlCalls().some((sql) => sql.includes("team_lesson_revisions"))).toBe(false);
    role = "owner";
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisions: [expect.objectContaining({ id: "rev", version: 3 })] });
  });

  it("answers an outage as a 503 error, and a missing migration as setup", async () => {
    const get = () => GET(new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}`), context);
    fake.query.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }));
    const down = await get();
    expect(down.status).toBe(503);
    expect((await down.json()).status).not.toBe("setup_required");
    fake.query.mockRejectedValue(Object.assign(new Error('relation "team_lessons" does not exist'), { code: "42P01" }));
    const missing = await get();
    expect(missing.status).toBe(200);
    expect((await missing.json()).status).toBe("setup_required");
  });

  it("answers 404 for a lesson id that is not a UUID, without a query", async () => {
    const response = await GET(new Request(`https://vantage.example/api/team-lessons/x?orgId=${orgId}`), { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(404);
    expect(fake.withRls).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/team-lessons/[id] (autosave)", () => {
  beforeEach(() => {
    lesson = lessonRow({ status: "draft", createdBy: "member", version: 4 });
  });

  it("saves the author's draft and returns the new version", async () => {
    const response = await PATCH(json("PATCH", { orgId, version: 4, title: "Wiring 101", body }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 5, updatedAt: "2026-10-11T12:00:00Z" });
    const update = fake.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE team_lessons"));
    expect(update?.[1]).toEqual(expect.arrayContaining([id, orgId, "Wiring 101", JSON.stringify(body), "member", 4]));
    // History first, then the write, then pruning, all in the one transaction.
    const order = sqlCalls().map((sql) => (sql.includes("INSERT INTO team_lesson_revisions") ? "snapshot" : sql.includes("UPDATE team_lessons") ? "update" : sql.includes("DELETE FROM team_lesson_revisions") ? "prune" : null)).filter(Boolean);
    expect(order).toEqual(["snapshot", "update", "prune"]);
    expect(fake.withRls).toHaveBeenCalledTimes(1);
  });

  it("answers 409 with the saved lesson when someone else saved first, and writes nothing", async () => {
    lesson = lessonRow({ status: "draft", createdBy: "member", version: 6, title: "Their title", updatedByName: "Grace" });
    const response = await PATCH(json("PATCH", { orgId, version: 4, title: "Mine" }), context);
    expect(response.status).toBe(409);
    const conflict = (await response.json()).conflict;
    expect(conflict).toMatchObject({ version: 6, title: "Their title", updatedByName: "Grace", body });
    expect(sqlCalls().some((sql) => sql.includes("UPDATE team_lessons") || sql.includes("INSERT INTO"))).toBe(false);
  });

  it("refuses a malformed body before opening a transaction", async () => {
    const bad = { ...body, steps: [{ ...body.steps[0], html: "<script>" }] };
    expect((await PATCH(json("PATCH", { orgId, version: 4, body: bad }), context)).status).toBe(400);
    expect((await PATCH(json("PATCH", { orgId, version: 4, minutes: 900 }), context)).status).toBe(400);
    expect((await PATCH(json("PATCH", { orgId, title: "No version" }), context)).status).toBe(400);
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("tells a team member why a published lesson can't be changed", async () => {
    lesson = lessonRow({ status: "published", createdBy: "member" });
    const response = await PATCH(json("PATCH", { orgId, version: 4, title: "x" }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/back to draft/);
  });
});

describe("POST /api/team-lessons/[id]", () => {
  it("grades practice on the server and keeps the attempt", async () => {
    const response = await POST(json("POST", { orgId, action: "submit", answers: { "q-1": 1, "q-2": "  THE battery " } }), context);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ stored: true, result: { score: 2, total: 2, passed: true }, attempt: { id: "attempt" } });
    expect(JSON.stringify(result)).not.toMatch(/accepted|"answer"/);
    const insert = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO team_lesson_attempts"));
    expect(insert?.[1]).toEqual([orgId, id, "member", JSON.stringify({ "q-1": 1, "q-2": "  THE battery " }), 2, 2, true]);
  });

  it("grades a draft preview without recording it", async () => {
    lesson = lessonRow({ status: "draft", createdBy: "member" });
    const result = await (await POST(json("POST", { orgId, action: "submit", answers: { "q-1": 0 } }), context)).json();
    expect(result).toMatchObject({ stored: false, attempt: null, result: { score: 0, passed: false } });
    expect(sqlCalls().some((sql) => sql.includes("INSERT INTO team_lesson_attempts"))).toBe(false);
  });

  it("lists what is missing instead of publishing an unfinished lesson", async () => {
    lesson = lessonRow({ status: "draft", createdBy: "member", body: { steps: [{ id: "s", title: "", text: "" }], practice: [] } });
    const response = await POST(json("POST", { orgId, action: "publish", version: 4 }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).problems).toEqual(["Step 1 needs a title.", "Step 1 has no text yet."]);
    expect(sqlCalls().some((sql) => sql.includes("UPDATE team_lessons"))).toBe(false);
  });

  it("publishes and always keeps that version in History", async () => {
    lesson = lessonRow({ status: "draft", createdBy: "member" });
    const response = await POST(json("POST", { orgId, action: "publish", version: 4 }), context);
    expect(response.status).toBe(200);
    const snapshot = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO team_lesson_revisions"));
    expect(snapshot?.[1]?.[3]).toBe(true);
  });

  it("keeps status changes for owners and admins", async () => {
    expect((await POST(json("POST", { orgId, action: "archive" }), context)).status).toBe(403);
    role = "owner";
    expect((await POST(json("POST", { orgId, action: "archive" }), context)).status).toBe(200);
  });

  it("refuses an unknown action and a bad file id", async () => {
    expect((await POST(json("POST", { orgId, action: "explode" }), context)).status).toBe(400);
    role = "admin";
    expect((await POST(json("POST", { orgId, action: "attach-pdf", version: 4, fileId: "nope" }), context)).status).toBe(400);
  });
});

describe("DELETE /api/team-lessons/[id]", () => {
  it("lets a team member delete only their own draft", async () => {
    const request = () => new Request(`https://vantage.example/api/team-lessons/${id}?orgId=${orgId}`, { method: "DELETE" });
    expect((await DELETE(request(), context)).status).toBe(403);
    lesson = lessonRow({ status: "draft", createdBy: "member" });
    expect((await DELETE(request(), context)).status).toBe(200);
  });
});
