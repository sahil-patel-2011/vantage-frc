import { describe, expect, it } from "vitest";
import {
  VIDEO_ANALYSIS_RELATED_INCLUDE,
  classifyVideoAnalysisShell,
  formatVideoAnalysisMetric,
  formatVideoSourceRef,
  isVideoAnalysisQueueEmpty,
  labelVideoSourceKind,
  labelVideoStatus,
  pendingVideoConfirmCount,
  videoAnalysisNextActions,
  videoAnalysisRelatedLinks,
  videoAnalysisSetupSteps,
  videoAnalysisShellCopy,
  videoEventSureLabel,
  type VideoAnalysisJob,
} from "./video-analysis-related";
import { expectPlainCopy } from "../ui/copy-assertions";

function job(partial: Partial<VideoAnalysisJob>): VideoAnalysisJob {
  return {
    id: "j1",
    sourceKind: "youtube",
    sourceRef: "https://youtu.be/abc",
    matchKey: null,
    status: "queued",
    minutesBehind: null,
    error: null,
    createdAt: "2026-09-11T00:00:00Z",
    result: null,
    confirmed: false,
    ...partial,
  };
}

describe("videoAnalysisRelatedLinks", () => {
  it("builds Event day / Match notes / Match video via hubHref / withOrgHref", () => {
    const links = videoAnalysisRelatedLinks("org-1", {
      include: [...VIDEO_ANALYSIS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "match-notes", "match-video"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(links.find((l) => l.id === "match-notes")?.href).toBe(
      "/match-notes-timeline?orgId=org-1",
    );
    expect(links.find((l) => l.id === "match-video")?.href).toBe("/video?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(videoAnalysisRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("videoAnalysisSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    const steps = videoAnalysisSetupSteps(null);
    expect(steps.map((s) => s.id)).toEqual(["workspace"]);
    expect(steps[0]?.href).toBe("/workspace");
  });

  it("with a team there is no extra setup wall", () => {
    expect(videoAnalysisSetupSteps("org-1")).toEqual([]);
  });
});

describe("Video metrics", () => {
  it("formats real counts only", () => {
    expect(formatVideoAnalysisMetric(4, true)).toBe("4");
    expect(formatVideoAnalysisMetric(0, false)).toBe("…");
    expect(formatVideoAnalysisMetric(-1, true)).toBe("0");
  });

  it("treats zero queued videos as empty", () => {
    expect(isVideoAnalysisQueueEmpty({ jobCount: 0 })).toBe(true);
    expect(isVideoAnalysisQueueEmpty({ jobCount: 2 })).toBe(false);
  });

  it("counts only finished videos that still need confirm", () => {
    expect(
      pendingVideoConfirmCount([
        job({ id: "a", status: "completed", confirmed: false }),
        job({ id: "b", status: "completed", confirmed: true }),
        job({ id: "c", status: "running", confirmed: false }),
      ]),
    ).toBe(1);
  });
});

describe("classifyVideoAnalysisShell", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyVideoAnalysisShell({ loading: true })).toBe("loading");
    expect(classifyVideoAnalysisShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyVideoAnalysisShell({ orgId: null })).toBe("setup");
    expect(classifyVideoAnalysisShell({ orgId: "o", jobCount: 0 })).toBe("empty");
    expect(classifyVideoAnalysisShell({ orgId: "o", jobCount: 2 })).toBe("ready");
  });
});

describe("videoAnalysisShellCopy", () => {
  it("refuses invented DEMO copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = videoAnalysisShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expect(videoAnalysisShellCopy("setup").badge).toBe("Needs setup");
    expect(videoAnalysisShellCopy("setup").title).toBe("Choose your team");
    expect(videoAnalysisShellCopy("empty").title).toBe("Paste a match or pit video");
  });
});

describe("student labels", () => {
  it("names sources without file-id jargon", () => {
    expect(labelVideoSourceKind("youtube")).toBe("YouTube");
    expect(labelVideoSourceKind("tba")).toBe("Official match page");
    expect(labelVideoSourceKind("upload")).toBe("File");
    expect(labelVideoSourceKind("pit_stream")).toBe("Pit camera");
    expect(labelVideoSourceKind("pit_camera")).toBe("Pit camera");
    expect(labelVideoSourceKind("mystery")).toBe("Video");
  });

  it("names status without queued/running tokens", () => {
    expect(labelVideoStatus("queued", false)).toBe("Waiting");
    expect(labelVideoStatus("running", false)).toBe("Watching");
    expect(labelVideoStatus("completed", false)).toBe("Ready to confirm");
    expect(labelVideoStatus("completed", true)).toBe("Saved as evidence");
    expect(labelVideoStatus("skipped", false)).toBe("Skipped — this computer cannot watch video");
  });

  it("never prints a raw confidence number", () => {
    expect(videoEventSureLabel(undefined)).toBe("from video");
    expect(videoEventSureLabel(0.91)).toBe("from video · looks clear");
    expect(videoEventSureLabel(0.6)).toBe("from video · looks likely");
    expect(videoEventSureLabel(0.2)).toBe("from video · unsure");
    expect(videoEventSureLabel(0.91)).not.toMatch(/0\.91/);
  });

  it("never prints an upload file id", () => {
    expect(formatVideoSourceRef("upload", "9c1e0b2a-3d4f-5a67-8b9c-0d1e2f3a4b5c")).toBe(
      "Uploaded file",
    );
    expect(formatVideoSourceRef("upload", "https://files.example/clip.mp4")).toBe("Uploaded file");
    expect(formatVideoSourceRef("youtube", "https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(formatVideoSourceRef("tba", "2026miket_qm12")).toBe("2026miket_qm12");
    expect(formatVideoSourceRef("pit_stream", "aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb")).toBe(
      "Pit camera",
    );
  });
});

describe("videoAnalysisNextActions", () => {
  it("gates on Choose your team when org is missing", () => {
    const actions = videoAnalysisNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.primary).toBe(true);
  });

  it("empty and error shells do not paint a next-actions wall", () => {
    expect(videoAnalysisNextActions({ orgId: "org-1", shell: "empty", jobCount: 0 })).toEqual([]);
    expect(videoAnalysisNextActions({ orgId: "org-1", shell: "error" })).toEqual([]);
  });

  it("ready boards prioritize confirm without related-strip twins", () => {
    const actions = videoAnalysisNextActions({
      orgId: "org-1",
      shell: "ready",
      jobCount: 3,
      pendingConfirmCount: 2,
    });
    expect(actions[0]?.id).toBe("confirm");
    expect(actions[0]?.href).toBe("#video-ready");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "relays")).toBe(false);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
