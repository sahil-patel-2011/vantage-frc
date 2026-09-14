"use client";

import { syncEntriesToQrRecords, type ScoutQrRecord } from "@vantage/scouting/qr-handoff";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormRow, Button } from "../../components/ui";
import { listPendingEntries, mergeRecordsIntoOutbox, syncOutbox } from "../../lib/scout-offline";
import { relayDeviceRoleLabel } from "../../lib/scout-p2p-relay";
import {
  envelopeBelongsToSession,
  isP2pEnvelope,
  parseP2pEnvelope,
  p2pChannelName,
  p2pMergeLedgerCounts,
  type ScoutP2pEnvelope,
} from "../../lib/scout-p2p-relay/pit-mesh";
import type { RelayDeviceRole, RelaySession } from "../../lib/scout-p2p-relay/types";

const DEVICE_KEY = "vantage-p2p-device";

type DeviceIdentity = { deviceId: string; deviceLabel: string; deviceRole: RelayDeviceRole };

function readIdentity(): DeviceIdentity {
  try {
    const raw = sessionStorage.getItem(DEVICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;
      if (parsed.deviceId && parsed.deviceLabel) {
        return {
          deviceId: parsed.deviceId,
          deviceLabel: parsed.deviceLabel,
          deviceRole: parsed.deviceRole === "captain" ? "captain" : "scout",
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { deviceId: crypto.randomUUID(), deviceLabel: "", deviceRole: "scout" };
}

function writeIdentity(identity: DeviceIdentity) {
  sessionStorage.setItem(DEVICE_KEY, JSON.stringify(identity));
}

type Peer = { deviceId: string; deviceLabel: string; deviceRole: RelayDeviceRole; lastSeenAt: string };

export function PitMeshPanel({
  orgId,
  session,
  busy,
  mutate,
}: {
  orgId: string;
  session: RelaySession;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [identity, setIdentity] = useState<DeviceIdentity>({ deviceId: "", deviceLabel: "", deviceRole: "scout" });
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState(
    "Tabs on this page share automatically. Paste a token from another tablet below.",
  );
  const [paste, setPaste] = useState("");
  const [shareJson, setShareJson] = useState("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    setIdentity(readIdentity());
  }, []);

  const closed = session.status === "closed";

  const buildEnvelope = useCallback(async (): Promise<ScoutP2pEnvelope | null> => {
    if (!identity.deviceLabel.trim()) return null;
    const pending = await listPendingEntries();
    const scoped = pending.filter((entry) => !session.eventKey || entry.eventKey === session.eventKey);
    return {
      v: 1,
      orgId,
      sessionId: session.id,
      deviceId: identity.deviceId,
      deviceLabel: identity.deviceLabel.trim(),
      deviceRole: identity.deviceRole,
      records: syncEntriesToQrRecords(scoped),
      sentAt: new Date().toISOString(),
    };
  }, [identity, orgId, session.eventKey, session.id]);

  const applyEnvelope = useCallback(
    async (envelope: ScoutP2pEnvelope) => {
      if (!envelopeBelongsToSession(envelope, { orgId, sessionId: session.id })) return;
      if (envelope.deviceId === identityRef.current.deviceId) return;
      setPeers((current) => {
        const next = current.filter((peer) => peer.deviceId !== envelope.deviceId);
        next.push({
          deviceId: envelope.deviceId,
          deviceLabel: envelope.deviceLabel,
          deviceRole: envelope.deviceRole,
          lastSeenAt: envelope.sentAt,
        });
        return next.sort((a, b) => a.deviceLabel.localeCompare(b.deviceLabel));
      });
      if (!envelope.records.length) return;
      const merged = await mergeRecordsIntoOutbox({
        records: envelope.records as ScoutQrRecord[],
        schemaId: envelope.records[0]?.schemaId ?? "p2p",
        type: envelope.records[0]?.type === "pit" ? "pit" : "match",
      });
      const counts = p2pMergeLedgerCounts(merged);
      setStatus(
        `Merged ${counts.entriesContributed} from ${envelope.deviceLabel} (${counts.conflictsResolved} newer replacements).`,
      );
    },
    [orgId, session.id],
  );

  const broadcast = useCallback(async () => {
    const envelope = await buildEnvelope();
    if (!envelope) {
      setStatus("Name this tablet before joining the pit mesh.");
      return;
    }
    writeIdentity({
      deviceId: envelope.deviceId,
      deviceLabel: envelope.deviceLabel,
      deviceRole: envelope.deviceRole,
    });
    setShareJson(JSON.stringify(envelope));
    channelRef.current?.postMessage(envelope);
    setStatus(`Shared ${envelope.records.length} local ${envelope.records.length === 1 ? "entry" : "entries"} with other tabs.`);
  }, [buildEnvelope]);

  useEffect(() => {
    if (!joined || closed || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(p2pChannelName(orgId, session.id));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isP2pEnvelope(event.data)) void applyEnvelope(event.data);
    };
    void broadcast();
    const timer = window.setInterval(() => {
      void broadcast();
    }, 8000);
    return () => {
      window.clearInterval(timer);
      channel.close();
      channelRef.current = null;
    };
  }, [applyEnvelope, broadcast, closed, joined, orgId, session.id]);

  const acceptPaste = useMemo(() => parseP2pEnvelope(paste), [paste]);

  if (closed) return null;

  return (
    <div className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>Pit link</h3>
      <p className="app-muted" style={{ margin: 0 }}>
        Tabs in the same browser share automatically. For another tablet, paste the copied text or use QR scout
        handoff. Only entries saved on this device are shared.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <FormRow label="This device">
          <input
            value={identity.deviceLabel}
            onChange={(event) => setIdentity((prev) => ({ ...prev, deviceLabel: event.target.value }))}
            placeholder="Scout Tablet A"
          />
        </FormRow>
        <FormRow label="Role">
          <select
            value={identity.deviceRole}
            onChange={(event) =>
              setIdentity((prev) => ({
                ...prev,
                deviceRole: event.target.value === "captain" ? "captain" : "scout",
              }))
            }
          >
            <option value="scout">{relayDeviceRoleLabel("scout")}</option>
            <option value="captain">{relayDeviceRoleLabel("captain")}</option>
          </select>
        </FormRow>
        <Button variant="secondary" type="button" disabled={!identity.deviceLabel.trim()} onClick={() => { writeIdentity(identity); setJoined(true); void broadcast(); }}>
          {joined ? "Share now" : "Join pit mesh"}
        </Button>
        <Button variant="primary" type="button" disabled={busy || !identity.deviceLabel.trim()} onClick={() => { void (async () => { const envelope = await buildEnvelope(); const contributed = envelope?.records.length ?? 0; mutate({ action: "log-entry", sessionId: session.id, deviceLabel: identity.deviceLabel, deviceRole: identity.deviceRole, entriesContributed: contributed, conflictsResolved: 0, uplinked: true, }); await syncOutbox(orgId); setStatus(`Sent ${contributed} local ${contributed === 1 ? "entry" : "entries"} to Vantage.`); })(); }}>
          Send to Vantage
        </Button>
      </div>
      <p role="status" className="app-muted">
        {status}
      </p>
      {peers.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {peers.map((peer) => (
            <li key={peer.deviceId}>
              {peer.deviceLabel} ({relayDeviceRoleLabel(peer.deviceRole)})
            </li>
          ))}
        </ul>
      ) : null}
      {shareJson ? (
        <FormRow label="Share token">
          <textarea readOnly rows={3} value={shareJson} />
        </FormRow>
      ) : null}
      <FormRow label="Paste a token from another tablet">
        <textarea rows={3} value={paste} onChange={(event) => setPaste(event.target.value)} />
      </FormRow>
      <div>
        <Button variant="secondary" type="button" disabled={!acceptPaste} onClick={() => { if (!acceptPaste) return; void applyEnvelope(acceptPaste); setPaste(""); }}>
          Merge pasted token
        </Button>
      </div>
    </div>
  );
}
