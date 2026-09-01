import { describe, expect, it } from "vitest";
import { hostedScoutMediaCapBytes, scoutMediaPutByteLimitError } from "../scouting/prepare-scout-media";
import { MAX_SCOUT_MEDIA_BYTES } from "../scouting/media-downscale";
import {
  HOSTED_VIDEO_CAP_BYTES,
  NODE_VIDEO_CAP_BYTES,
  exceedsHostedVideoCap,
  hostedVideoCapBytes,
  hostedVideoOversizeMessage,
} from "./hosted-video-cap";

const FOUR_MIB = 4 * 1024 * 1024;
const SIX_MIB = 6 * 1024 * 1024;
const HUNDRED_MIB = 100 * 1024 * 1024;

describe("hosted video caps", () => {
  it("advertises 4 MiB on the cloud path and 100 MiB only as the node/schema ceiling", () => {
    expect(HOSTED_VIDEO_CAP_BYTES).toBe(FOUR_MIB);
    expect(NODE_VIDEO_CAP_BYTES).toBe(HUNDRED_MIB);
    expect(hostedVideoCapBytes({ VERCEL: "1" })).toBe(FOUR_MIB);
    expect(hostedVideoCapBytes({})).toBe(HUNDRED_MIB);
  });

  it("refuses 6–100 MB video on Vercel instead of letting the edge 413", () => {
    expect(exceedsHostedVideoCap(SIX_MIB, { VERCEL: "1" })).toBe(true);
    expect(exceedsHostedVideoCap(HUNDRED_MIB, { VERCEL: "1" })).toBe(true);
    expect(exceedsHostedVideoCap(FOUR_MIB, { VERCEL: "1" })).toBe(false);
    expect(exceedsHostedVideoCap(SIX_MIB, {})).toBe(false);
  });

  it("names 4.0 MB — never 100 MB — when a hosted upload is over the cloud cap", () => {
    const message = hostedVideoOversizeMessage(SIX_MIB, { VERCEL: "1" });
    expect(message).toContain("6.0 MB");
    expect(message).toContain("4.0 MB");
    expect(message).toContain("storage node");
    expect(message).not.toContain("100.0 MB");
  });
});

describe("hosted scout PUT cap helper", () => {
  it("drops the historical 6 MB scout cap to 4 MiB on Vercel", () => {
    expect(MAX_SCOUT_MEDIA_BYTES).toBe(SIX_MIB);
    expect(hostedScoutMediaCapBytes({ VERCEL: "1" })).toBe(FOUR_MIB);
    expect(hostedScoutMediaCapBytes({})).toBe(SIX_MIB);
  });

  it("builds a 400 body so the PUT can refuse before a 413-at-edge", () => {
    expect(scoutMediaPutByteLimitError(SIX_MIB, { VERCEL: "1" })).toEqual({
      error: `Media must be between 1 byte and ${FOUR_MIB} bytes`,
    });
    expect(scoutMediaPutByteLimitError(FOUR_MIB, { VERCEL: "1" })).toBeNull();
    expect(scoutMediaPutByteLimitError(0, { VERCEL: "1" })).toEqual({
      error: `Media must be between 1 byte and ${FOUR_MIB} bytes`,
    });
    expect(scoutMediaPutByteLimitError(SIX_MIB, {})).toBeNull();
  });
});
