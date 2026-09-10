import { describe, expect, it } from "vitest";
import { asMediaFile } from "./scouting-media-browser";

describe("asMediaFile", () => {
  it("keeps an already-File blob", () => {
    const file = new File(["x"], "robot.png", { type: "image/png" });
    expect(asMediaFile(file, file)).toBe(file);
  });

  it("wraps a JPEG blob with a .jpg name when the original was not JPEG", () => {
    const original = new File(["png"], "robot.png", { type: "image/png" });
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const next = asMediaFile(blob, original);
    expect(next).toBeInstanceOf(File);
    expect(next.name).toBe("robot.jpg");
    expect(next.type).toBe("image/jpeg");
  });
});
