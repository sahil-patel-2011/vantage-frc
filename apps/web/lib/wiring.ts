// Robot wiring / CAN-bus map. A registry of every electrical device on the robot
// with its CAN ID, CAN bus, power-distribution port, and subsystem — the thing
// teams usually keep in a messy spreadsheet. The payoff is automatic conflict
// detection: two same-type devices sharing a CAN ID on a bus is a classic bug
// that silently bricks a device, and two devices on one power port is another.

export type DeviceTypeDef = { value: string; label: string; usesCan: boolean };

export const DEVICE_TYPES: DeviceTypeDef[] = [
  { value: "talonfx", label: "Talon FX (Falcon / Kraken)", usesCan: true },
  { value: "sparkmax", label: "SPARK MAX", usesCan: true },
  { value: "sparkflex", label: "SPARK Flex", usesCan: true },
  { value: "talonsrx", label: "Talon SRX", usesCan: true },
  { value: "victorspx", label: "Victor SPX", usesCan: true },
  { value: "cancoder", label: "CANcoder", usesCan: true },
  { value: "pigeon", label: "Pigeon 2 IMU", usesCan: true },
  { value: "candle", label: "CANdle", usesCan: true },
  { value: "pdh", label: "Power Distribution Hub", usesCan: true },
  { value: "pdp", label: "Power Distribution Panel", usesCan: true },
  { value: "ph", label: "Pneumatic Hub", usesCan: true },
  { value: "pcm", label: "Pneumatics Control Module", usesCan: true },
  { value: "roborio", label: "roboRIO", usesCan: false },
  { value: "radio", label: "Radio", usesCan: false },
  { value: "vrm", label: "Voltage Regulator Module", usesCan: false },
  { value: "rps", label: "Radio Power Supply (Pi/POE)", usesCan: false },
  { value: "switch", label: "Network switch", usesCan: false },
  { value: "servo", label: "Servo", usesCan: false },
  { value: "servohub", label: "REV Servo Hub", usesCan: true },
  { value: "other", label: "Other", usesCan: false },
];

const DEVICE_TYPE_MAP = new Map(DEVICE_TYPES.map((d) => [d.value, d]));
export function deviceTypeLabel(value: string) {
  return DEVICE_TYPE_MAP.get(value)?.label ?? value;
}
export function deviceUsesCan(value: string) {
  return DEVICE_TYPE_MAP.get(value)?.usesCan ?? false;
}

export const CAN_BUSES = ["rio", "canivore"] as const;
export type CanBus = (typeof CAN_BUSES)[number];

// CTRE/REV CAN device IDs are 0-62 (63 is reserved/broadcast).
export const CAN_ID_MIN = 0;
export const CAN_ID_MAX = 62;
// Power Distribution Hub has channels 0-23; PDP has 0-15. We accept 0-23.
export const PORT_MAX = 23;

export type DeviceInput = {
  name: string;
  deviceType: string;
  canId: number | null;
  canBus: CanBus;
  pdhPort: number | null;
  breakerAmp: number | null;
  subsystem: string;
  notes: string;
};

function intInRange(value: unknown, min: number, max: number, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${field} must be a whole number from ${min} to ${max}`);
  return parsed;
}

export function validateDevice(raw: Record<string, unknown>): { ok: true; value: DeviceInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Device name is required" };
  const deviceType = String(raw.deviceType ?? "");
  if (!DEVICE_TYPE_MAP.has(deviceType)) return { ok: false, error: "Invalid device type" };
  const canBus = String(raw.canBus ?? "rio");
  if (!CAN_BUSES.includes(canBus as CanBus)) return { ok: false, error: "Invalid CAN bus" };
  let canId: number | null;
  let pdhPort: number | null;
  let breakerAmp: number | null;
  try {
    canId = intInRange(raw.canId, CAN_ID_MIN, CAN_ID_MAX, "CAN ID");
    pdhPort = intInRange(raw.pdhPort, 0, PORT_MAX, "Power port");
    breakerAmp = intInRange(raw.breakerAmp, 0, 60, "Breaker (A)");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid number" };
  }
  return {
    ok: true,
    value: {
      name,
      deviceType,
      canId,
      canBus: canBus as CanBus,
      pdhPort,
      breakerAmp,
      subsystem: typeof raw.subsystem === "string" ? raw.subsystem.trim() : "",
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

export type Device = {
  id: string;
  name: string;
  deviceType: string;
  canId: number | null;
  canBus: CanBus;
  pdhPort: number | null;
  breakerAmp?: number | null;
};

export type WiringConflict =
  | { kind: "can_id"; canBus: CanBus; deviceType: string; canId: number; deviceNames: string[] }
  | { kind: "power_port"; port: number; deviceNames: string[] };

/**
 * Two devices of the SAME type sharing a CAN ID on the SAME bus is a hard
 * conflict (different device families may legally share an ID, so we key on
 * type). Two devices on one power port is also flagged.
 */
export function detectConflicts(devices: Device[]): WiringConflict[] {
  const conflicts: WiringConflict[] = [];

  const canGroups = new Map<string, Device[]>();
  for (const d of devices) {
    if (d.canId == null || !deviceUsesCan(d.deviceType)) continue;
    const key = `${d.canBus}::${d.deviceType}::${d.canId}`;
    const arr = canGroups.get(key) ?? [];
    arr.push(d);
    canGroups.set(key, arr);
  }
  for (const [, group] of canGroups) {
    if (group.length > 1) {
      const first = group[0]!;
      conflicts.push({ kind: "can_id", canBus: first.canBus, deviceType: first.deviceType, canId: first.canId!, deviceNames: group.map((d) => d.name) });
    }
  }

  const portGroups = new Map<number, Device[]>();
  for (const d of devices) {
    if (d.pdhPort == null) continue;
    const arr = portGroups.get(d.pdhPort) ?? [];
    arr.push(d);
    portGroups.set(d.pdhPort, arr);
  }
  for (const [port, group] of portGroups) {
    if (group.length > 1) conflicts.push({ kind: "power_port", port, deviceNames: group.map((d) => d.name) });
  }

  return conflicts;
}

const PCM_PH_TYPES = new Set(["pcm", "ph"]);

/**
 * Inspection checklist: PCM/PH must sit on the roboRIO CAN bus.
 * Cue only a logged pneumatics module with no CAN ID — never invent a PCM.
 */
export function pcmPhCanCues(devices: Pick<Device, "name" | "deviceType" | "canId">[]): string[] {
  return devices
    .filter((device) => PCM_PH_TYPES.has(device.deviceType) && device.canId == null)
    .map(
      (device) =>
        `${device.name}: PCM/PH must be on the roboRIO CAN bus — inspectors fail a module that is only powered.`,
    );
}

function isServoHub(device: Pick<Device, "name" | "deviceType">): boolean {
  return device.deviceType === "servohub" || /servo\s*hub/i.test(device.name);
}

/**
 * CD / R621: a Servo Hub needs its own PD branch with a breaker ≤ 20A.
 * Cue only a logged hub — never invent one.
 */
export function servoHubCues(devices: Device[]): string[] {
  const hubs = devices.filter(isServoHub);
  if (!hubs.length) return [];
  const portCounts = new Map<number, number>();
  for (const device of devices) {
    if (device.pdhPort == null) continue;
    portCounts.set(device.pdhPort, (portCounts.get(device.pdhPort) ?? 0) + 1);
  }
  const cues: string[] = [];
  for (const hub of hubs) {
    if (hub.canId == null) {
      cues.push(
        `${hub.name}: Servo Hub must be on the roboRIO CAN bus (R715) — inspectors fail a hub that is only powered.`,
      );
    }
    if (hub.breakerAmp != null && hub.breakerAmp > 20) {
      cues.push(`${hub.name}: Servo Hub must sit on its own PD branch with a breaker ≤ 20A (R621).`);
    }
    if (hub.pdhPort != null && (portCounts.get(hub.pdhPort) ?? 0) > 1) {
      cues.push(`${hub.name}: Servo Hub cannot share a PD breaker with another load (R621).`);
    }
  }
  return cues;
}

/**
 * CD / R506: servos may only connect to RIO PWM, WCP-0045, SPM, or a Servo Hub.
 * Cue a logged servo on a PD port — never invent one, and never flag a Servo Hub.
 */
export function servoPowerCues(devices: Device[]): string[] {
  return devices
    .filter((device) => device.deviceType === "servo" && device.pdhPort != null)
    .map(
      (device) =>
        `${device.name}: servos may only connect to RIO PWM, WCP-0045, a Servo Power Module, or a Servo Hub (R506) — not a raw PD 6V brick.`,
    );
}

export function summarizeWiring(devices: Device[]) {
  const conflicts = detectConflicts(devices);
  const canCount = devices.filter((d) => d.canId != null && deviceUsesCan(d.deviceType)).length;
  return {
    totalDevices: devices.length,
    canDevices: canCount,
    conflicts,
    conflictCount: conflicts.length,
    pcmPhCanCues: pcmPhCanCues(devices),
    servoHubCues: servoHubCues(devices),
    servoPowerCues: servoPowerCues(devices),
  };
}

// ---- request validation --------------------------------------------------

export type WiringAction =
  | ({ action: "create_device"; orgId: string; seasonYear: number } & DeviceInput)
  | { action: "update_device"; orgId: string; id: string; patch: DeviceInput }
  | { action: "delete_device"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseWiringAction(raw: unknown): WiringAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_device": {
      const validated = validateDevice(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "update_device": {
      const validated = validateDevice(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "delete_device":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported wiring action");
  }
}
