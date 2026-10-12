/**
 * Backup mode: Vantage runs with no database at all, exactly as it would if the NAS lost its
 * connection, and teams read their Google Sheets copy until it is back (docs/NAS_DATABASE.md,
 * "Backup mode"). Turned on with VANTAGE_BACKUP_MODE=1 in Vercel; off when it is unset.
 *
 * Every pool is a stand-in that refuses at once, so no request ever reaches a database (and none
 * is billed), whatever DATABASE_* still holds. Nothing is read, written or deleted: the database
 * and its data stay exactly as they were for when the mode is turned off.
 *
 * No imports, so the proxy, server code and tests can all use it.
 */

export const BACKUP_MODE_CODE = "VANTAGE_BACKUP_MODE";

export const BACKUP_MODE_MESSAGE =
  "Vantage is running from its backup while the team server reconnects. Each team's data is safe in its Google Sheets copy; sign-in and changes reopen when the server is back.";

/** Read at call time (never inlined at build), so flipping the variable needs only a redeploy. */
export function isBackupMode(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.VANTAGE_BACKUP_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export class BackupModeError extends Error {
  readonly code = BACKUP_MODE_CODE;
  constructor() {
    super("Vantage is in backup mode: no database is connected.");
    this.name = "BackupModeError";
  }
}

/** True for a BackupModeError, or an error whose cause chain holds one. */
export function isBackupModeError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === BACKUP_MODE_CODE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type Callback = (error: Error) => void;

function refuse(args: unknown[]): Promise<never> | undefined {
  const error = new BackupModeError();
  const last = args[args.length - 1];
  const callback = typeof last === "function" ? (last as Callback) : null;
  if (callback) {
    queueMicrotask(() => callback(error));
    return undefined;
  }
  return Promise.reject(error);
}

/**
 * Stands in for a pg / Neon pool. `connect()` and `query()` fail straight away with
 * BackupModeError, the way an unreachable NAS fails without the wait; `end()` and the event
 * methods are harmless no-ops.
 */
export class DisconnectedPool {
  readonly totalCount = 0;
  readonly idleCount = 0;
  readonly waitingCount = 0;
  ended = false;

  connect(...args: unknown[]) {
    return refuse(args);
  }

  query(...args: unknown[]) {
    return refuse(args);
  }

  end(callback?: () => void) {
    this.ended = true;
    if (callback) queueMicrotask(callback);
    return Promise.resolve();
  }

  on() {
    return this;
  }

  once() {
    return this;
  }

  off() {
    return this;
  }

  removeListener() {
    return this;
  }

  removeAllListeners() {
    return this;
  }
}
