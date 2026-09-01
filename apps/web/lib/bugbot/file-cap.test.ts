import { describe, expect, it } from "vitest";
import { BUGBOT_SCAN_CHUNK_FILES, BUGBOT_SCAN_MAX_CHUNKS } from "@vantage/agent/bugbot";
import { assertBugbotFilesForModel, BUGBOT_FILE_CAP, enforceBugbotFileCap } from "./file-cap";

describe("enforceBugbotFileCap", () => {
  it("uses the agent chunk budget, not the old 80-file picker slice", () => {
    expect(BUGBOT_FILE_CAP).toBe(BUGBOT_SCAN_CHUNK_FILES * BUGBOT_SCAN_MAX_CHUNKS);
    expect(BUGBOT_FILE_CAP).toBeLessThan(80);
  });

  it("keeps files inside the cap and reports the rest as deferred", () => {
    const files = Array.from({ length: BUGBOT_FILE_CAP + 5 }, (_, index) => `src/File${index}.java`);
    const result = enforceBugbotFileCap(files);
    expect(result.included).toHaveLength(BUGBOT_FILE_CAP);
    expect(result.deferred).toHaveLength(5);
    expect(result.empty).toBe(false);
    expect(result.included.at(-1)).toBe(`src/File${BUGBOT_FILE_CAP - 1}.java`);
  });

  it("marks an empty list so the caller cannot send it to a model", () => {
    const result = enforceBugbotFileCap([]);
    expect(result.empty).toBe(true);
    expect(result.included).toEqual([]);
    expect(() => assertBugbotFilesForModel(result)).toThrow(/file-cap left no robot-code files/i);
  });
});
