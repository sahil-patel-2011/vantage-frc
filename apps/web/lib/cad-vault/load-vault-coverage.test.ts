import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadVaultDocumentCounts } from "./load-vault-coverage";
import { countMissingCad } from "./blueprint-coverage";

const ORG = "11111111-1111-4111-8111-111111111111";
const DRIVE = "22222222-2222-4222-8222-222222222222";
const INTAKE = "33333333-3333-4333-8333-333333333333";

type Call = { sql: string; params: unknown[] };

function mockClient(options: {
  installed?: boolean;
  rows?: Array<{ subsystemId: string; documentCount: number }>;
}) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("to_regclass")) {
        return options.installed === false ? { rows: [{ ok: null }], rowCount: 1 } : { rows: [{ ok: "cad_documents" }], rowCount: 1 };
      }
      if (sql.includes("FROM cad_documents")) {
        return { rows: options.rows ?? [], rowCount: (options.rows ?? []).length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

describe("loadVaultDocumentCounts", () => {
  it("returns an empty map when the vault table is not installed (no invented rows)", async () => {
    const { client, calls } = mockClient({ installed: false });
    const counts = await loadVaultDocumentCounts(client, ORG);
    expect(counts.size).toBe(0);
    expect(calls.some((call) => call.sql.includes("FROM cad_documents"))).toBe(false);
  });

  it("scopes the count query to org_id and skips archived rows in SQL", async () => {
    const { client, calls } = mockClient({
      rows: [{ subsystemId: DRIVE, documentCount: 2 }],
    });
    const counts = await loadVaultDocumentCounts(client, ORG, [DRIVE, INTAKE]);
    expect(counts.get(DRIVE)).toBe(2);
    expect(counts.has(INTAKE)).toBe(false);

    const select = calls.find((call) => call.sql.includes("FROM cad_documents"));
    expect(select).toBeDefined();
    expect(select!.sql).toContain("$1::uuid");
    expect(select!.sql).toContain("status <> 'archived'");
    expect(select!.params[0]).toBe(ORG);
    expect(select!.params[1]).toEqual([DRIVE, INTAKE]);
  });

  it("feeds missingCad so a vault row covers a subsystem without a URL", async () => {
    const { client } = mockClient({
      rows: [{ subsystemId: DRIVE, documentCount: 1 }],
    });
    const counts = await loadVaultDocumentCounts(client, ORG);
    expect(
      countMissingCad([
        { id: DRIVE, cadUrl: null, vaultDocumentCount: counts.get(DRIVE) ?? 0 },
        { id: INTAKE, cadUrl: null, vaultDocumentCount: counts.get(INTAKE) ?? 0 },
      ]),
    ).toBe(1);
  });
});
