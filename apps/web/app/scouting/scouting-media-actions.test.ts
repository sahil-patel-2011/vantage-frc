import { expect, it, vi } from "vitest";
import { MEDIA_PAUSED_MESSAGE } from "../../lib/media-availability";
import { attachScoutingMedia } from "./scouting-media-actions";

it("rejects paused media before reading the file or touching the outbox", async () => {
  const file = new Proxy({} as File, { get() { throw new Error("Paused media must not be processed"); } });
  const setMessage = vi.fn();
  const refreshCounts = vi.fn();
  const sync = vi.fn();
  const result = await attachScoutingMedia(file, undefined, {
    orgId: "team", eventKey: "event", teamKey: "frc6925", entryClientId: "report",
    setMessage, refreshCounts, sync,
  });
  expect(result).toBeNull();
  expect(setMessage).toHaveBeenCalledWith(MEDIA_PAUSED_MESSAGE);
  expect(refreshCounts).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});
