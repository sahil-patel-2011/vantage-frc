import { describe, expect, it } from "vitest";
import type { DriveFile } from "../../lib/drive/types";
import { fileIcon, formatWhen, railScope, storageLabel } from "./files-model";

describe("files-model", () => {
  it("maps My files to personal and every other rail to team", () => {
    expect(railScope("my")).toBe("personal");
    expect(railScope("team")).toBe("team");
    expect(railScope("shared")).toBe("team");
  });

  it("labels storage from the file's real location, never a DEMO place", () => {
    expect(storageLabel({ storageLocation: "node" } as DriveFile)).toBe("On your storage node");
    expect(storageLabel({ storageLocation: "object" } as DriveFile)).toBe("In object storage");
    expect(storageLabel({ storageLocation: "db" } as DriveFile)).toBe("In Vantage");
    expect(storageLabel({ storageLocation: "db" } as DriveFile)).not.toMatch(/demo/i);
  });

  it("picks an icon from content class and prints a dash for a missing date", () => {
    expect(fileIcon({ contentClass: "video", contentType: "video/mp4" })).toBe("▶");
    expect(fileIcon({ contentClass: "cad", contentType: "model/step" })).toBe("◈");
    expect(formatWhen(null)).toBe("—");
  });
});
