import { describe, expect, it } from "vitest";
import {
  StorageKeyOrgMismatchError,
  assertKeyForOrg,
  cadStorageKey,
  safeCadFilename,
  titleFromFilename,
} from "./filenames";

describe("safeCadFilename", () => {
  it("strips traversal sequences and unsafe characters", () => {
    expect(safeCadFilename("../../etc/passwd")).toBe("etc-passwd");
    expect(safeCadFilename("intake roller (v2).stl")).toBe("intake-roller-v2.stl");
  });

  it("never returns an empty name", () => {
    expect(safeCadFilename("???")).toBe("cad-file");
    expect(safeCadFilename("")).toBe("cad-file");
  });

  it("caps length at 180", () => {
    expect(safeCadFilename(`${"a".repeat(400)}.stl`).length).toBeLessThanOrEqual(180);
  });
});

describe("cadStorageKey / assertKeyForOrg", () => {
  const orgId = "3f1f7a3e-1111-4222-8333-944455566677";
  const docId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("prefixes the key with the org id so the key itself proves tenancy", () => {
    const key = cadStorageKey(orgId, docId, 3, "arm bracket.stl");
    expect(key).toBe(`${orgId}/cad-vault/${docId}/v3/arm-bracket.stl`);
    expect(() => assertKeyForOrg(key, orgId)).not.toThrow();
  });

  it("throws the typed error for a foreign org", () => {
    const key = cadStorageKey(orgId, docId, 1, "x.stl");
    expect(() => assertKeyForOrg(key, "00000000-0000-4000-8000-000000000000")).toThrow(StorageKeyOrgMismatchError);
  });
});

describe("titleFromFilename", () => {
  it("derives a readable title", () => {
    expect(titleFromFilename("intake_roller-bracket_v2.stl")).toBe("intake roller bracket v2");
  });

  it("falls back rather than returning an empty title", () => {
    expect(titleFromFilename("")).toBe("cad file");
    expect(titleFromFilename("---")).toBe("cad file");
  });
});
