import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));

const orgId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
let role: string | null = "scout";

const row = (id: string, status: string, createdBy: string) => ({
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
});

beforeEach(() => {
  vi.resetAllMocks();
  role = "scout";
  fake.session.mockResolvedValue({ user: { id: "member" } });
  fake.withRls.mockImplementation(async (_context, work) => work({ query: fake.query }));
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM memberships")) return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    if (sql.includes("jsonb_array_length")) return { rows: [row(lessonId, "published", "someone"), row(draftId, "draft", "member")], rowCount: 2 };
    if (sql.includes("DISTINCT ON")) return { rows: [{ lessonId, score: 2, total: 2, passed: true, at: "2026-10-11T11:00:00Z" }], rowCount: 1 };
    if (sql.includes("INSERT INTO team_lessons")) return { rows: [{ id: draftId, version: 1 }], rowCount: 1 };
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
    expect(view.drafts).toEqual([expect.objectContaining({ id: draftId, canEdit: true, best: null })]);
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
