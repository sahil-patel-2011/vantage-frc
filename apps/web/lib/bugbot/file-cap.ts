/**
 * Bugbot file-cap.
 *
 * A metered pass has a hard ceiling: chunk size × max chunks from
 * `@vantage/agent/bugbot`. The Code file picker used to slice to 80, which is
 * past that budget and silently implied coverage the scan cannot buy. Every
 * list that will reach a model — or that claims to be the scan set — goes
 * through `enforceBugbotFileCap`.
 */

import { BUGBOT_SCAN_CHUNK_FILES, BUGBOT_SCAN_MAX_CHUNKS } from "@vantage/agent/bugbot";

/** Hard ceiling on robot-code files one Bugbot operation may send to a model. */
export const BUGBOT_FILE_CAP = BUGBOT_SCAN_CHUNK_FILES * BUGBOT_SCAN_MAX_CHUNKS;

export type BugbotFileCapResult<T> = {
  included: T[];
  deferred: T[];
  cap: number;
  empty: boolean;
};

export function enforceBugbotFileCap<T>(
  files: readonly T[],
  options?: { cap?: number },
): BugbotFileCapResult<T> {
  const cap = Math.max(1, Math.floor(options?.cap ?? BUGBOT_FILE_CAP));
  const included = files.slice(0, cap);
  const deferred = files.slice(cap);
  return {
    included: [...included],
    deferred: [...deferred],
    cap,
    empty: included.length === 0,
  };
}

/**
 * Refuse a model call whose file list is empty after the cap. An empty list is
 * not "scan the sample" and not "the repo is clean" — it is a missing source.
 */
export function assertBugbotFilesForModel<T>(result: BugbotFileCapResult<T>): T[] {
  if (result.empty) {
    throw new Error("Bugbot file-cap left no robot-code files to send to the model");
  }
  return result.included;
}
