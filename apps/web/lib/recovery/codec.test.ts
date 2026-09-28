import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { EnvKeyKmsService } from "@vantage/billing";
import { decodeRecovery, encodeRecovery, RECOVERY_CELL_SIZE } from "./codec";
describe("lossless encrypted recovery cells", () => {
  const kms = new EnvKeyKmsService(randomBytes(32).toString("base64"));
  it("preserves precision, large JSON, microseconds, Unicode and formula-like text", async () => {
    const text = '{"amount":123456789012345678901234567890.123456789,"stamp":"2026-09-26T12:00:00.123456Z","note":"=SUM(A:A)","data":"' + randomBytes(150000).toString("base64") + '🤖"}';
    const record = await encodeRecovery("snapshot:1", text, kms);
    expect(record.parts.length).toBeGreaterThan(1);
    expect(record.parts.every((part) => part.value.length <= RECOVERY_CELL_SIZE)).toBe(true);
    expect(record.parts.map((part) => part.value).join("")).not.toContain("amount");
    expect(await decodeRecovery(record.envelope, [...record.parts].reverse(), kms)).toBe(text);
  });
  it("refuses tampering, missing or duplicate chunks, wrong keys and transplanted IDs", async () => {
    const record = await encodeRecovery("snapshot:2", "private record", kms);
    await expect(decodeRecovery(record.envelope, [], kms)).rejects.toThrow();
    await expect(decodeRecovery(record.envelope, [...record.parts, record.parts[0]!], kms)).rejects.toThrow();
    await expect(decodeRecovery(record.envelope, [{ index: 0, value: "AAAA" }], kms)).rejects.toThrow();
    await expect(decodeRecovery(record.envelope, record.parts, new EnvKeyKmsService(randomBytes(32).toString("base64")))).rejects.toThrow();
    await expect(decodeRecovery({ ...record.envelope, id: "different" }, record.parts, kms)).rejects.toThrow();
  });
});
