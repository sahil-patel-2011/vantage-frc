import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import {
  HttpError,
  isUuid,
  requireWorkbookManager,
  requireWorkbookViewer,
  roleCanManageWorkbook,
  roleCanViewWorkbook,
} from "./authz";

const ORG = "6925a000-0000-4000-8000-000000000001";
const USER = "6925a000-0000-4000-8000-000000000002";

function clientWithRole(role: string | null) {
  const seen: unknown[][] = [];
  const client = {
    async query(_sql: string, params: unknown[]) {
      seen.push(params);
      return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    },
  } as unknown as PoolClient;
  return { client, seen };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof HttpError ? `${error.status}:${error.code}` : "other";
  }
}

describe("workbook authorization", () => {
  it("only owners and admins manage the connection", () => {
    expect(roleCanManageWorkbook("owner")).toBe(true);
    expect(roleCanManageWorkbook("admin")).toBe(true);
    expect(roleCanManageWorkbook("scout")).toBe(false);
    expect(roleCanManageWorkbook("viewer")).toBe(false);
    expect(roleCanManageWorkbook(null)).toBe(false);
  });

  it("any member can view status", () => {
    for (const role of ["owner", "admin", "scout", "viewer"]) expect(roleCanViewWorkbook(role)).toBe(true);
    expect(roleCanViewWorkbook(null)).toBe(false);
    expect(roleCanViewWorkbook("")).toBe(false);
  });

  it("requireWorkbookManager refuses scouts, viewers and non-members with distinct codes", async () => {
    expect(await codeOf(requireWorkbookManager(clientWithRole("admin").client, ORG, USER))).toBeNull();
    expect(await codeOf(requireWorkbookManager(clientWithRole("owner").client, ORG, USER))).toBeNull();
    expect(await codeOf(requireWorkbookManager(clientWithRole("scout").client, ORG, USER))).toBe("403:not_manager");
    expect(await codeOf(requireWorkbookManager(clientWithRole("viewer").client, ORG, USER))).toBe("403:not_manager");
    expect(await codeOf(requireWorkbookManager(clientWithRole(null).client, ORG, USER))).toBe("403:not_member");
  });

  it("requireWorkbookViewer admits every member and refuses outsiders", async () => {
    expect(await codeOf(requireWorkbookViewer(clientWithRole("viewer").client, ORG, USER))).toBeNull();
    expect(await codeOf(requireWorkbookViewer(clientWithRole(null).client, ORG, USER))).toBe("403:not_member");
  });

  it("checks the membership of the exact org and user, by parameter", async () => {
    const { client, seen } = clientWithRole("admin");
    await requireWorkbookManager(client, ORG, USER);
    expect(seen).toEqual([[ORG, USER]]);
  });

  it("validates uuids", () => {
    expect(isUuid(ORG)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
