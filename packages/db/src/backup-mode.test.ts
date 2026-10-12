import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupModeError, DisconnectedPool, isBackupMode, isBackupModeError } from "./backup-mode";
import { createRawSqlPool } from "./pool";

describe("backup mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on only for an explicit yes", () => {
    for (const value of ["1", "true", "on", "yes", " TRUE "]) expect(isBackupMode({ VANTAGE_BACKUP_MODE: value })).toBe(true);
    for (const value of [undefined, "", "0", "false", "off", "no", "sheets"]) expect(isBackupMode({ VANTAGE_BACKUP_MODE: value })).toBe(false);
  });

  it("gives every pool a stand-in that refuses at once and never connects", async () => {
    vi.stubEnv("VANTAGE_BACKUP_MODE", "1");
    const created = createRawSqlPool("postgresql://vantage_app:secret@db.example.neon.tech/vantage");
    expect(created).toBeInstanceOf(DisconnectedPool);
    const pool = created as unknown as DisconnectedPool;
    await expect(pool.connect()).rejects.toBeInstanceOf(BackupModeError);
    await expect(pool.query("SELECT 1")).rejects.toMatchObject({ code: "VANTAGE_BACKUP_MODE" });
    await expect(pool.end()).resolves.toBeUndefined();
  });

  it("does not care whether a database URL is set at all", () => {
    vi.stubEnv("VANTAGE_BACKUP_MODE", "1");
    expect(createRawSqlPool("")).toBeInstanceOf(DisconnectedPool);
  });

  it("answers callback-style calls with the error instead of an unhandled rejection", async () => {
    const pool = new DisconnectedPool();
    const error = await new Promise<Error>((resolve) => {
      expect(pool.query("SELECT 1", [], resolve)).toBeUndefined();
    });
    expect(isBackupModeError(error)).toBe(true);
  });

  it("recognises the error through a cause chain", () => {
    expect(isBackupModeError(new Error("wrapped", { cause: new BackupModeError() }))).toBe(true);
    expect(isBackupModeError(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isBackupModeError(null)).toBe(false);
  });

  it("leaves pools alone when it is off", () => {
    vi.stubEnv("VANTAGE_BACKUP_MODE", "");
    expect(createRawSqlPool("postgresql://vantage_app:local@localhost:5432/vantage")).not.toBeInstanceOf(DisconnectedPool);
  });
});
