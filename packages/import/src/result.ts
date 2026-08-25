/**
 * Shared result shape for every Vantage importer.
 *
 * Three rules hold across all connectors:
 *  - IMPORTERS NEVER INVENT ROWS. A record that lacks the identity the target
 *    needs is pushed onto `skipped` with a human reason, never guessed.
 *  - Unrecognized file shapes throw `ImportShapeError`, whose message names what
 *    was expected. A best-guess silent import is worse than a clear rejection.
 *  - Every draft carries provenance, and a stable `idempotencyKey` where the
 *    target supports one, so re-importing the same file changes nothing.
 */

/** A row/field the importer deliberately did not import, and why. */
export type ImportSkip = { ref: string; reason: string };

/** A row the importer tried to read and could not, without failing the file. */
export type ImportIssue = { ref: string; message: string };

export type ImportResult<TDraft> = {
  drafts: TDraft[];
  skipped: ImportSkip[];
  errors: ImportIssue[];
};

/** Thrown when a file does not look like the format the connector accepts. */
export class ImportShapeError extends Error {
  readonly expected: string;

  constructor(found: string, expected: string) {
    super(`${found} Expected ${expected}`);
    this.name = "ImportShapeError";
    this.expected = expected;
  }
}

export function rejectShape(found: string, expected: string): never {
  throw new ImportShapeError(found, expected);
}

export function emptyResult<TDraft>(): ImportResult<TDraft> {
  return { drafts: [], skipped: [], errors: [] };
}

/** Parse JSON, rejecting with a message that names the connector's format. */
export function parseJsonOrReject(content: string, expected: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unparseable";
    rejectShape(`That file is not valid JSON (${detail}).`, expected);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
