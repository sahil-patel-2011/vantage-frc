import { getEditorRelayPool } from "@vantage/db/editor-relay";
import { requireEditorDevice } from "../../../../lib/editor/device-auth";

export async function GET(request: Request) {
  const device = await requireEditorDevice(request);
  if (device instanceof Response) return device;

  return Response.json({
    deviceId: device.id,
    userId: device.userId,
    orgId: device.orgId,
    orgName: device.orgName,
    machineName: device.machineName,
    scopes: device.scopes,
    status: device.status,
  });
}

/** Revoke the current device token (called from the extension on Sign out). */
export async function DELETE(request: Request) {
  const device = await requireEditorDevice(request);
  if (device instanceof Response) return device;

  await getEditorRelayPool().query(
    `UPDATE editor_devices
     SET status = 'revoked', revoked_at = now(), updated_at = now()
     WHERE id = $1`,
    [device.id],
  );

  return Response.json({ success: true });
}
