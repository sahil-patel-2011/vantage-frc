import type { AppsScriptBridge } from "../google-sheets/apps-script-bridge";
import { type KeyManagementService } from "@vantage/billing";
import { createRecoveryKms } from "./kms";
import { decodeRecovery, encodeRecovery, type RecoveryEnvelope, type RecoveryPart } from "./codec";
import { recoveryTestScope } from "./test-scope";

export async function writeRecoveryRecord(bridge: AppsScriptBridge, bookKey: string, id: string, text: string, kms: KeyManagementService = createRecoveryKms(), scope = recoveryTestScope()) {
  const { envelope, parts } = await encodeRecovery(id, text, kms);
  let spreadsheetId = "";
  for (let offset = 0; offset < parts.length; offset += 20) {
    const result = await bridge.call<{ ok: boolean; id: string }>("recovery.write", {
      bookKey, id, offset, envelope, ...scope, parts: parts.slice(offset, offset + 20).map((part) => part.value), final: offset + 20 >= parts.length,
    });
    spreadsheetId = result.id;
  }
  const read = await readRecoveryRecord(bridge, bookKey, id, kms, scope);
  if (read !== text) throw new Error("Google recovery read-back did not match the source.");
  return { bookKey, id, spreadsheetId, ...scope, hash: envelope.sha256, bytes: envelope.bytes };
}

export async function readRecoveryRecord(bridge: AppsScriptBridge, bookKey: string, id: string, kms: KeyManagementService = createRecoveryKms(), scope = recoveryTestScope()) {
  let envelope: RecoveryEnvelope | null = null;
  const parts: RecoveryPart[] = [];
  for (let offset = 0; envelope === null || offset < envelope.parts; offset += 20) {
    const page = await bridge.call<{ ok: boolean; envelope: RecoveryEnvelope; parts: RecoveryPart[] }>("recovery.read", { bookKey, id, offset, limit: 20, ...scope });
    if (envelope && JSON.stringify(page.envelope) !== JSON.stringify(envelope)) throw new Error("Recovery record changed during read-back.");
    envelope = page.envelope;
    if (!Number.isInteger(envelope.parts) || envelope.parts < 1 || !page.parts.length) throw new Error("Recovery record is incomplete.");
    parts.push(...page.parts);
  }
  return decodeRecovery(envelope!, parts, kms);
}
