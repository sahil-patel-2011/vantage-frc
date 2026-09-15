import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(join(__dirname, "..", "..", "app", "api", "agent", "todos", "route.ts"), "utf8");

describe("agent working-todos route", () => {
  it("lists via withRls + listWorkingTodosResult and never uses the worker role", () => {
    expect(route).toMatch(/listWorkingTodosResult/);
    expect(route).toMatch(/withRls/);
    expect(route).toMatch(/org_id=\$1::uuid/);
    expect(route).toMatch(/user_id=\$2::uuid/);
    expect(route).not.toMatch(/@vantage\/db\/admin/);
    expect(route).not.toMatch(/dbAdmin/);
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function POST/);
    expect(route).toMatch(/setup_required: true/);
    expect(route).toMatch(/status: 503/);
  });
});
