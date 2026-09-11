import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(WEB_ROOT, rel), "utf8");
}

const HUBS = [
  "app/competition/competition-hub.tsx",
  "app/team/team-hub.tsx",
  "app/build/build-hub.tsx",
  "app/ai/ai-hub.tsx",
] as const;

const HEAVY_PAGES = [
  "app/competition/page.tsx",
  "app/team/page.tsx",
  "app/build/page.tsx",
  "app/ai/page.tsx",
  "app/dashboard/page.tsx",
  "app/files/page.tsx",
  "app/intel/page.tsx",
  "app/print-farm/page.tsx",
  "app/writer/page.tsx",
  "app/video/page.tsx",
  "app/business/page.tsx",
] as const;

describe("heavy board split", () => {
  it("loads hub workbenches through next/dynamic, not a static client import", () => {
    for (const hub of HUBS) {
      const src = read(hub);
      expect(src, hub).toMatch(/from ["']next\/dynamic["']/);
      expect(src, hub).toMatch(/dynamic\(\(\) => import\(/);
      expect(src, hub).not.toMatch(
        /from ["']\.\.\/(?:command|scouting|strategy|cad|kickoff|writer)\/[\w-]+-client["']/,
      );
      expect(src, hub).not.toMatch(/from ["']\.\/finance-in-ai-panel["']/);
    }
  });

  it("does not compile every board stylesheet on the first hub visit", () => {
    const competition = read("app/competition/competition-hub.tsx");
    expect(competition).not.toMatch(/scouting\.css/);
    expect(competition).not.toMatch(/forms\.css/);
    expect(competition).not.toMatch(/my-day\.css/);

    const team = read("app/team/team-hub.tsx");
    expect(team).not.toMatch(/team-calendar\.css/);
    expect(team).not.toMatch(/attendance\.css/);
    expect(team).not.toMatch(/practice\.css/);
    expect(team).not.toMatch(/knowledge\.css/);
    expect(team).not.toMatch(/batteries\.css/);
    expect(team).not.toMatch(/todos\.css/);

    const build = read("app/build/build-hub.tsx");
    expect(build).not.toMatch(/code\.css/);
    expect(build).not.toMatch(/kickoff\.css/);

    const ai = read("app/ai/ai-hub.tsx");
    expect(ai).not.toMatch(/chat\.css/);
    expect(ai).not.toMatch(/code\.css/);
  });

  it("keeps each board's CSS on the client that paints it", () => {
    expect(read("app/scouting/scouting-client.tsx")).toMatch(/import ["']\.\/scouting\.css["']/);
    expect(read("app/scouting/forms/forms-client.tsx")).toMatch(/import ["']\.\/forms\.css["']/);
    expect(read("app/my-day/my-day-client.tsx")).toMatch(/import ["']\.\/my-day\.css["']/);
    expect(read("app/kickoff/kickoff-client.tsx")).toMatch(/import ["']\.\/kickoff\.css["']/);
    expect(read("app/code/code-client.tsx")).toMatch(/import ["']\.\/code\.css["']/);
    expect(read("app/chat/chat-client.tsx")).toMatch(/import ["']\.\/chat\.css["']/);
    expect(read("app/team/calendar/team-calendar-client.tsx")).toMatch(
      /import ["']\.\/team-calendar\.css["']/,
    );
    expect(read("app/files/files-client.tsx")).toMatch(/import ["']\.\/files\.css["']/);
    expect(read("app/video/video-rescout-client.tsx")).toMatch(/import ["']\.\/video-rescout\.css["']/);
  });

  it("lazy-loads hub shells and a few heavy standalone boards", () => {
    for (const page of HEAVY_PAGES) {
      const src = read(page);
      expect(src, page).toMatch(/from ["']next\/dynamic["']/);
      expect(src, page).toMatch(/dynamic\(\(\) => import\(/);
    }
  });
});
