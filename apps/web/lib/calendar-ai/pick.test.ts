import { describe, expect, it } from "vitest";
import { pickToDraft, toLocalInputValue } from "./pick";

const BASE = {
  startsAt: "2026-09-15T22:00:00.000Z",
  endsAt: "2026-09-16T00:00:00.000Z",
  title: "Build session",
  kind: "build",
  subteamId: null as string | null,
};

describe("pickToDraft", () => {
  it("keeps a kind the create form knows", () => {
    expect(pickToDraft({ ...BASE, kind: "build" }, []).kind).toBe("build");
    expect(pickToDraft({ ...BASE, kind: "outreach" }, []).kind).toBe("outreach");
  });

  it("falls back to meeting for a kind the form would reject", () => {
    // The route clamps this too; both layers matter, because the form's own
    // <select> would otherwise show a blank option.
    expect(pickToDraft({ ...BASE, kind: "standup" }, []).kind).toBe("meeting");
    expect(pickToDraft({ ...BASE, kind: "" }, []).kind).toBe("meeting");
  });

  it("keeps a subteam this team has", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(pickToDraft({ ...BASE, subteamId: id }, [id]).subteamId).toBe(id);
  });

  it("drops a subteam this browser does not know, rather than sending a bad id", () => {
    const draft = pickToDraft({ ...BASE, subteamId: "22222222-2222-4222-8222-222222222222" }, [
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(draft.subteamId).toBeNull();
  });

  it("never proposes an empty title, because the submit button would just be dead", () => {
    expect(pickToDraft({ ...BASE, title: "   " }, []).title).toBe("Team session");
  });

  it("converts both ends to wall-clock text the datetime-local input accepts", () => {
    const draft = pickToDraft(BASE, []);
    expect(draft.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(draft.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Two hours apart in the local zone, whatever that zone is.
    const span = new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime();
    expect(span).toBe(2 * 60 * 60 * 1000);
  });

  it("leaves the end blank when it is missing or unparseable", () => {
    expect(pickToDraft({ ...BASE, endsAt: "" }, []).endsAt).toBe("");
    expect(pickToDraft({ ...BASE, endsAt: "not a date" }, []).endsAt).toBe("");
  });
});

describe("toLocalInputValue", () => {
  it("returns empty for null and for junk, never NaN text", () => {
    expect(toLocalInputValue(null)).toBe("");
    expect(toLocalInputValue("nope")).toBe("");
  });

  it("zero-pads, because 2026-9-5T6:00 is not a value the input accepts", () => {
    const value = toLocalInputValue(new Date(2026, 8, 5, 6, 4).toISOString());
    expect(value).toBe("2026-09-05T06:04");
  });
});
