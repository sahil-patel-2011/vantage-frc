import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));

const orgId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const fileId = "44444444-4444-4444-8444-444444444444";
const folderId = "55555555-5555-4555-8555-555555555555";
let role: string | null = "scout";
let pdfFile: Record<string, unknown> | undefined;

const row = (id: string, status: string, createdBy: string, best: { score: number; total: number; passed: boolean; at: string } | null = null) => ({
  id,
  title: status === "published" ? "Deploying code" : "Wiring",
  summary: "",
  audience: "Rookies",
  minutes: 20,
  status,
  source: "editor",
  stepCount: 3,
  questionCount: 2,
  createdBy,
  createdByName: "Ada",
  updatedAt: "2026-10-11T10:00:00Z",
  publishedAt: status === "published" ? "2026-10-11T10:00:00Z" : null,
  bestScore: best?.score ?? null,
  bestTotal: best?.total ?? null,
  bestPassed: best?.passed ?? null,
  bestAt: best?.at ?? null,
});

beforeEach(() => {
  vi.resetAllMocks();
  role = "scout";
  pdfFile = { name: "Wiring.pdf", scope: "team", status: "ready", contentType: "application/pdf", deleted: false };
  fake.session.mockResolvedValue({ user: { id: "member" } });
  fake.withRls.mockImplementation(async (_context, work) => work({ query: fake.query }));
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM memberships")) return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    // One statement: the lessons with the person's best attempt joined on.
    if (sql.includes("jsonb_array_length")) {
      const best = { score: 2, total: 2, passed: true, at: "2026-10-11T11:00:00Z" };
      return { rows: [row(lessonId, "published", "someone", best), row(draftId, "draft", "member")], rowCount: 2 };
    }
    if (sql.includes("INSERT INTO team_lessons")) return { rows: [{ id: draftId, version: 1 }], rowCount: 1 };
    // Attaching the PDF on create: the new draft (this person's), the file, the update.
    if (sql.includes("FROM team_lessons l")) {
      return { rows: [{ ...row(draftId, "draft", "member"), orgId, body: { steps: [], practice: [] }, version: 1, pdfFileId: null }], rowCount: 1 };
    }
    if (sql.includes("FROM drive_files")) return { rows: [pdfFile], rowCount: pdfFile ? 1 : 0 };
    if (sql.includes("UPDATE team_lessons")) return { rows: [{ version: 2, updatedAt: "2026-10-11T12:00:00Z" }], rowCount: 1 };
    if (sql.includes("FROM drive_folders")) return { rows: [{ id: folderId }], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  });
});

const list = (query = `?orgId=${orgId}`) => GET(new Request(`https://vantage.example/api/team-lessons${query}`));
const create = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new Request("https://vantage.example/api/team-lessons", { method: "POST", headers, body: JSON.stringify(body) }));

describe("GET /api/team-lessons", () => {
  it("needs a session", async () => {
    fake.session.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed team id before touching the database", async () => {
    expect((await list("")).status).toBe(400);
    expect((await list("?orgId=1;DROP TABLE x")).status).toBe(400);
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("runs under RLS for this person and team, and refuses non-members", async () => {
    role = null;
    expect((await list()).status).toBe(403);
    expect(fake.withRls).toHaveBeenCalledWith({ userId: "member", orgId }, expect.any(Function));
  });

  it("splits published lessons from drafts and carries the person's best result", async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const view = await response.json();
    expect(view).toMatchObject({ status: "ready", orgId, role: "scout", canCreate: true, canManage: false });
    expect(view.published).toEqual([expect.objectContaining({ id: lessonId, canEdit: false, best: expect.objectContaining({ score: 2, passed: true }) })]);
    expect(view.drafts).toEqual([expect.objectContaining({ id: draftId, canEdit: true, canDelete: true, best: null })]);
    expect(view.published[0]).not.toHaveProperty("bestScore");
  });

  it("reads the list and the best attempts in one statement, with both values as parameters", async () => {
    await list();
    const reads = fake.query.mock.calls.filter(([sql]) => !String(sql).includes("FROM memberships"));
    expect(reads).toHaveLength(1);
    expect(reads[0][1]).toEqual([orgId, "member"]);
  });

  it("answers an outage as a 503 error, not as setup", async () => {
    fake.query.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }));
    const response = await list();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).not.toBe("setup_required");
    expect(body.error).toMatch(/Couldn't reach Vantage/);
    expect(body.error).not.toMatch(/ECONNREFUSED|5432/);
  });

  it("answers a setup state, not an error, before the migration is applied", async () => {
    fake.query.mockRejectedValue(Object.assign(new Error('relation "team_lessons" does not exist'), { code: "42P01" }));
    const response = await list();
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.status).toBe("setup_required");
    expect(view.message).not.toMatch(/relation|team_lessons|0717/);
  });
});

describe("POST /api/team-lessons", () => {
  it("creates a draft owned by the signed-in person", async () => {
    const response = await create({ orgId, title: "  Swerve basics " });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: draftId, version: 1 });
    const insert = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO team_lessons"));
    expect(insert?.[1]).toEqual([orgId, "Swerve basics", "member"]);
  });

  it("makes no nameless lesson: a blank title is refused before anything is written", async () => {
    for (const title of [undefined, "", "   "]) {
      const response = await create({ orgId, title });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Give the lesson a title.");
    }
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
  });

  it("creates a PDF lesson in one step when the upload's file id comes along", async () => {
    const response = await create({ orgId, title: "Wiring", pdfFileId: fileId });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: draftId, version: 2 });
    const attach = fake.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE team_lessons"));
    expect(String(attach?.[0])).toContain("source = 'pdf'");
    expect(attach?.[1]).toEqual([draftId, orgId, fileId, "member"]);
    // One transaction: a refused file fails the whole request, so no empty draft is left.
    expect(fake.withRls).toHaveBeenCalledTimes(1);
  });

  it("refuses a file that isn't a ready team PDF, and a malformed file id", async () => {
    pdfFile = { name: "notes.txt", scope: "team", status: "ready", contentType: "text/plain", deleted: false };
    expect((await create({ orgId, title: "Wiring", pdfFileId: fileId })).status).toBe(422);
    expect((await create({ orgId, title: "Wiring", pdfFileId: "nope" })).status).toBe(400);
  });

  it("answers where a new PDF lesson's file goes, for people who can write lessons", async () => {
    const response = await create({ orgId, action: "pdf-folder" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ folderId });
    role = "viewer";
    expect((await create({ orgId, action: "pdf-folder" })).status).toBe(403);
    expect((await create({ orgId, action: "explode" })).status).toBe(400);
  });

  it("does not let a View only member write a lesson", async () => {
    role = "viewer";
    expect((await create({ orgId })).status).toBe(403);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
  });

  it("takes JSON only, from this site", async () => {
    expect((await create({ orgId }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await create({ orgId }, { "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(fake.withRls).not.toHaveBeenCalled();
  });
});
