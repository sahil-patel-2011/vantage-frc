import { describe, expect, it, vi } from "vitest";
import {
  buildNotebookWikiBody,
  notebookTemplateKind,
  notebookWikiSlug,
  notebookWikiTags,
  notebookWikiTitle,
  promoteNotebookEntry,
  type PromotableEntry,
} from "./notebook-wiki";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Partial<PromotableEntry> = {}): PromotableEntry {
  return {
    id: "abcdef12-3456-4789-8abc-def123456789",
    title: "Switched the intake to compliant wheels",
    body: "Rollers slipped on the bumper edge, so we moved to 2in compliant wheels.",
    entryDate: "2026-02-14",
    phase: "iterate",
    subsystem: "Intake",
    tags: ["intake", "wheels"],
    seasonYear: 2026,
    authorName: "Ada Lovelace",
    attachments: [],
    ...overrides,
  };
}

describe("notebookWikiSlug", () => {
  it("is deterministic in the entry id so a second promotion finds the same page", () => {
    expect(notebookWikiSlug(entry())).toBe(notebookWikiSlug(entry()));
  });

  it("separates two entries that happen to share a title", () => {
    const a = notebookWikiSlug(entry({ id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    const b = notebookWikiSlug(entry({ id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(a).not.toBe(b);
  });

  it("survives a title with no slug-safe characters", () => {
    const slug = notebookWikiSlug(entry({ title: "!!! ???" }));
    expect(slug).toContain("notebook-entry");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("stays inside the slug column's length", () => {
    expect(notebookWikiSlug(entry({ title: "x".repeat(400) })).length).toBeLessThanOrEqual(120);
  });
});

describe("notebookWikiTitle", () => {
  it("prefixes the subsystem so the wiki index reads well", () => {
    expect(notebookWikiTitle(entry())).toBe("Intake: Switched the intake to compliant wheels");
  });

  it("leaves a subsystem-less entry's title alone", () => {
    expect(notebookWikiTitle(entry({ subsystem: "  " }))).toBe(
      "Switched the intake to compliant wheels",
    );
  });
});

describe("buildNotebookWikiBody", () => {
  it("leads with provenance so a later reader can judge whether it still applies", () => {
    const body = buildNotebookWikiBody(entry());
    expect(body.split("\n")[0]).toContain("2026-02-14");
    expect(body).toContain("Ada Lovelace");
    expect(body).toContain("Iterate");
  });

  it("keeps the original entry text", () => {
    expect(buildNotebookWikiBody(entry())).toContain("2in compliant wheels");
  });

  it("says so plainly when the entry had no body rather than emitting an empty section", () => {
    expect(buildNotebookWikiBody(entry({ body: "   " }))).toContain("no body text");
  });

  it("omits the author clause when the entry has no author name", () => {
    expect(buildNotebookWikiBody(entry({ authorName: null }))).not.toContain(" by ");
  });

  it("invites the next student to update it", () => {
    expect(buildNotebookWikiBody(entry())).toContain("Still true?");
  });

  it("says so plainly when no photo was attached rather than inventing one", () => {
    const body = buildNotebookWikiBody(entry({ attachments: [] }));
    expect(body).toContain("No photo was attached");
    expect(body).not.toContain("![");
  });

  it("embeds only the real attached photo URL", () => {
    const body = buildNotebookWikiBody(
      entry({
        attachments: [
          {
            assetId: "aaaaaaaa-1111-4111-8111-111111111111",
            title: "Intake CAD screenshot",
            kind: "photo",
            url: "https://cdn.example.test/intake.png",
            description: null,
          },
        ],
      }),
    );
    expect(body).toContain("![Intake CAD screenshot](https://cdn.example.test/intake.png)");
    expect(body).not.toContain("No photo was attached");
  });
});

describe("notebookWikiTags and template kind", () => {
  it("tags the page with its origin, subsystem, phase, and original tags", () => {
    const tags = notebookWikiTags(entry());
    expect(tags).toContain("notebook");
    expect(tags).toContain("intake");
    expect(tags).toContain("iterate");
  });

  it("does not duplicate a tag that matches the subsystem", () => {
    const tags = notebookWikiTags(entry({ subsystem: "Intake", tags: ["intake"] }));
    expect(tags.filter((tag) => tag === "intake")).toHaveLength(1);
  });

  it("does not copy reserved photo tags onto the wiki page", () => {
    const tags = notebookWikiTags(
      entry({ tags: ["intake", "asset:aaaaaaaa-1111-4111-8111-111111111111"] }),
    );
    expect(tags.some((tag) => tag.startsWith("asset:"))).toBe(false);
  });

  it("files a subsystem entry as a subsystem page and everything else as other", () => {
    expect(notebookTemplateKind({ subsystem: "Drivetrain" })).toBe("subsystem");
    expect(notebookTemplateKind({ subsystem: "" })).toBe("other");
  });
});

describe("promoteNotebookEntry", () => {
  function client(options: { found?: boolean; existingPage?: boolean }) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM notebook_entries")) {
        return options.found === false
          ? { rows: [], rowCount: 0 }
          : { rows: [entry()], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM knowledge_pages")) {
        return options.existingPage
          ? { rows: [{ id: "page-existing" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO knowledge_pages")) {
        return { rows: [{ id: "page-new" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    return {
      query,
      client: { query } as unknown as import("@neondatabase/serverless").PoolClient,
    };
  }

  it("creates the page on the first promotion", async () => {
    const { client: c, query } = client({});
    const result = await promoteNotebookEntry(c, { orgId: ORG, userId: USER, entryId: "e1" });
    expect(result).toMatchObject({ pageId: "page-new", alreadyPromoted: false });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))).toBe(
      true,
    );
  });

  it("returns the existing page instead of creating a duplicate", async () => {
    const { client: c, query } = client({ existingPage: true });
    const result = await promoteNotebookEntry(c, { orgId: ORG, userId: USER, entryId: "e1" });
    expect(result).toMatchObject({ pageId: "page-existing", alreadyPromoted: true });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))).toBe(
      false,
    );
  });

  it("scopes the entry read to the caller's org", async () => {
    const { client: c, query } = client({});
    await promoteNotebookEntry(c, { orgId: ORG, userId: USER, entryId: "e1" });
    const read = query.mock.calls.find(([sql]) => String(sql).includes("FROM notebook_entries"))!;
    expect(String(read[0])).toContain("n.org_id = $2::uuid");
    expect(read[1]).toEqual(["e1", ORG]);
  });

  it("refuses an entry id that is not this team's", async () => {
    const { client: c } = client({ found: false });
    await expect(
      promoteNotebookEntry(c, { orgId: ORG, userId: USER, entryId: "someone-elses" }),
    ).rejects.toThrow("Entry not found");
  });

  it("embeds a resolved media-kit photo and never invents one", async () => {
    const photo = {
      assetId: "aaaaaaaa-1111-4111-8111-111111111111",
      title: "Intake CAD screenshot",
      kind: "photo",
      url: "https://cdn.example.test/intake.png",
      description: null,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM notebook_entries")) {
        return {
          rows: [entry({ tags: ["intake", `asset:${photo.assetId}`] })],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM media_kit_assets")) {
        return { rows: [photo], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM knowledge_pages")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO knowledge_pages")) {
        return { rows: [{ id: "page-new" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await promoteNotebookEntry({ query } as unknown as import("@neondatabase/serverless").PoolClient, {
      orgId: ORG,
      userId: USER,
      entryId: "e1",
    });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))!;
    const body = String(insert[1]?.[3]);
    expect(body).toContain("![Intake CAD screenshot](https://cdn.example.test/intake.png)");
    expect(body).not.toContain("No photo was attached");
  });
});
