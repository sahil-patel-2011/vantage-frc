/** Vantage-only setup. No Onshape transport or browser session enters this module. */
const TRUSTED_VANTAGE_HOSTS = new Set([
  "vantagefrc.vercel.app", "frcvantage.vercel.app", "teamvantage.vercel.app",
  "vantagefrcweb.vercel.app", "vantagerobotics.vercel.app", "vantagefrc-scouting.vercel.app",
]);
export const DEFAULT_VANTAGE_ORIGIN = "https://vantagefrc.vercel.app";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Credential = Record<string, string>;
type PendingPair = {
  origin: URL; pollToken: string; userCode: string; verificationUrl: string;
  expiresAt: number; nextCheckAt: number; intervalMs: number;
  received?: Credential;
};
export type UiSetupStatus = {
  status: "pairing_required" | "pairing_pending" | "approval_required" | "eligible" | "denied" | "setup_required" | "unavailable";
  message: string; approvalUrl?: string; deviceId?: string; orgId?: string;
  userCode?: string; verificationUrl?: string; expiresAt?: string; checkAfterSeconds?: number;
};

export function validateVantagePairingOrigin(value: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || !TRUSTED_VANTAGE_HOSTS.has(origin.hostname) || origin.port ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("The browser pilot requires a trusted HTTPS Vantage pairing.");
  }
  return origin;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pairedCredential(value: unknown): Credential {
  if (!record(value) || typeof value.deviceToken !== "string" || !TOKEN.test(value.deviceToken) ||
    typeof value.deviceId !== "string" || !UUID.test(value.deviceId) ||
    typeof value.orgId !== "string" || !UUID.test(value.orgId) ||
    typeof value.userId !== "string" || !value.userId || value.userId.length > 200) {
    throw new Error("Vantage did not return a complete device approval. Start a new pairing.");
  }
  return { deviceToken: value.deviceToken, deviceId: value.deviceId, orgId: value.orgId, userId: value.userId };
}

export function createOnshapeUiSetup(options: {
  fetch: typeof fetch;
  load: () => Promise<Credential | null>;
  save: (value: Credential) => Promise<unknown>;
  signal: AbortSignal;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  // The existing server limits attempts per machine label. A private random
  // session suffix avoids making every team member share the same rate limit.
  const machineName = `Vantage browser ${crypto.randomUUID()}`;
  let pending: PendingPair | undefined;
  let disposed = false;
  const assertActive = () => { if (disposed || options.signal.aborted) throw new Error("The connector setup was closed. Reconnect before continuing."); };
  async function request(origin: URL, path: string, body?: unknown, token?: string) {
    assertActive();
    try {
      const response = await options.fetch(new URL(path, origin), {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", cache: "no-store",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]),
      });
      const data: unknown = await response.json();
      assertActive();
      if (!record(data)) throw new Error();
      return { ok: response.ok, data };
    } catch {
      // Never forward server error bodies, response URLs or transport diagnostics
      // that could contain a pairing/device credential to the model or logs.
      throw new Error("Vantage could not confirm this setup step. Check your connection and try the same step again.");
    }
  }
  async function load() {
    assertActive();
    let saved: Credential | null;
    try { saved = await options.load(); } catch { throw new Error("The existing Vantage credential store could not be read. Check its permissions before pairing again."); }
    assertActive();
    if (!saved) return null;
    const credential = pairedCredential(saved);
    if (saved.platform !== "onshape") return null;
    const origin = validateVantagePairingOrigin(saved.baseUrl!);
    return { credential: { ...credential, platform: "onshape", baseUrl: origin.origin }, origin };
  }
  const approval = (credential: Credential, origin: URL) => {
    const url = new URL("/cad/browser-agent", origin);
    url.searchParams.set("orgId", credential.orgId!);
    return { approvalUrl: url.href, deviceId: credential.deviceId!, orgId: credential.orgId! };
  };
  async function access() {
    const saved = await load();
    if (!saved) return { status: { status: "pairing_required", message: "Pair this connector with Vantage, then approve its Browser CAD access." } as UiSetupStatus };
    const { credential, origin } = saved;
    const { ok, data } = await request(origin, "/api/cad/browser-agent/access", undefined, credential.deviceToken);
    const links = approval(credential, origin);
    if (ok && data.allowed === true && data.status === "eligible" && data.transport === "onshape_browser_ui") {
      return { credential, status: { status: "eligible", message: "Current Team 6925 access is confirmed. Open Onshape explicitly when ready.", ...links } as UiSetupStatus };
    }
    const status: UiSetupStatus = data.reason === "team_sign_in_required"
      ? { status: "approval_required", message: "Open Browser CAD in Vantage and approve this device with your current team sign-in.", ...links }
      : data.reason === "device_invalid"
        ? { status: "pairing_required", message: "This device pairing is invalid or revoked. Start a replacement pairing in Vantage.", ...links }
        : data.status === "setup_required"
          ? { status: "setup_required", message: "The Team 6925 browser pilot is not configured on this Vantage deployment.", ...links }
          : data.reason === "pilot_membership_required"
            ? { status: "denied", message: "Current membership in the configured WA Robotics Team 6925 organization is required.", ...links }
            : { status: "unavailable", message: "Current pilot access could not be confirmed. No browser work is allowed.", ...links };
    return { status };
  }
  function pairingStatus(): UiSetupStatus {
    if (!pending) return { status: "pairing_required", message: "Start pairing, then open its Vantage approval link yourself." };
    return {
      status: "pairing_pending", message: pending.received ? "Vantage approved this device. Check pairing again to finish verifying and saving it." : "Open the Vantage link yourself, choose Team 6925 and Onshape, and approve. Check once after you finish; do not poll repeatedly.",
      userCode: pending.userCode, verificationUrl: pending.verificationUrl,
      expiresAt: new Date(pending.expiresAt).toISOString(),
      checkAfterSeconds: Math.max(0, Math.ceil((pending.nextCheckAt - now()) / 1_000)),
    };
  }
  return {
    async status(): Promise<UiSetupStatus> {
      if (pending && (pending.received || pending.expiresAt > now())) return pairingStatus();
      pending = undefined;
      try { return (await access()).status; }
      catch { return { status: "unavailable", message: "The credential store or current Vantage access could not be verified. No browser work is allowed." }; }
    },
    async authorize(): Promise<Credential> {
      if (pending) throw new Error("Finish or close the pending pairing before opening Onshape.");
      const result = await access();
      if (!result.credential) throw new Error(result.status.message);
      const current = await load();
      if (!current || current.credential.deviceToken !== result.credential.deviceToken || current.origin.origin !== result.credential.baseUrl) {
        throw new Error("The Vantage device pairing changed while access was checked. Check status again before continuing.");
      }
      return result.credential;
    },
    async pairStart(input: { vantageUrl?: string; replaceExisting?: boolean }): Promise<UiSetupStatus> {
      assertActive();
      if (pending && (pending.received || pending.expiresAt > now())) return pairingStatus();
      const origin = validateVantagePairingOrigin(input.vantageUrl ?? DEFAULT_VANTAGE_ORIGIN);
      let existing: Credential | null;
      try { existing = await options.load(); } catch { throw new Error("The credential store is unreadable. Repair it before replacing a pairing."); }
      if (existing && input.replaceExisting !== true) throw new Error("A Vantage pairing is already stored. Ask the user before starting with replaceExisting: true; the existing pairing is kept until a new Onshape approval is verified and saved.");
      const { ok, data } = await request(origin, "/api/cad/pair/start", { machineName, cliVersion: "0.1.1", platform: "onshape" });
      if (!ok || typeof data.pollToken !== "string" || !TOKEN.test(data.pollToken) ||
        typeof data.userCode !== "string" || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(data.userCode) ||
        typeof data.expiresIn !== "number" || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 600 ||
        typeof data.interval !== "number" || !Number.isFinite(data.interval) || data.interval < 1 || data.interval > 60 ||
        typeof data.verificationUri !== "string") throw new Error("Vantage did not issue a valid pairing. Check deployment setup and try again later.");
      let verification: URL;
      try { verification = new URL(data.verificationUri); }
      catch { throw new Error("Vantage returned an unexpected approval link. No pairing secret was shared."); }
      if (verification.origin !== origin.origin || verification.pathname !== "/cad/pair" || verification.username || verification.password || verification.hash ||
        verification.searchParams.get("code") !== data.userCode || [...verification.searchParams.keys()].some((key) => !["code", "platform"].includes(key)) ||
        verification.searchParams.has("platform") && verification.searchParams.get("platform") !== "onshape") {
        throw new Error("Vantage returned an unexpected approval link. No pairing secret was shared.");
      }
      verification.searchParams.set("platform", "onshape");
      pending = { origin, pollToken: data.pollToken, userCode: data.userCode, verificationUrl: verification.href, expiresAt: now() + data.expiresIn * 1_000, intervalMs: data.interval * 1_000, nextCheckAt: now() + data.interval * 1_000 };
      return pairingStatus();
    },
    async pairCheck(): Promise<UiSetupStatus> {
      assertActive();
      const pairing = pending;
      if (!pairing) throw new Error("Start pairing first. There is no pending approval in this connector session.");
      if (!pairing.received && pairing.expiresAt <= now()) { pending = undefined; throw new Error("Pairing expired. Start a new pairing and approve it in Vantage."); }
      if (now() < pairing.nextCheckAt) return pairingStatus();
      pairing.nextCheckAt = now() + pairing.intervalMs;
      if (!pairing.received) {
        const { ok, data } = await request(pairing.origin, "/api/cad/pair/poll", { pollToken: pairing.pollToken });
        if (ok && data.status === "pending") return pairingStatus();
        if (!ok || data.status !== "approved") {
          if (data.status === "expired" || data.status === "consumed") pending = undefined;
          throw new Error("Vantage could not confirm this pairing. If it expired or was consumed, start a new one.");
        }
        pairing.received = pairedCredential(data);
        pairing.pollToken = "";
      }
      const credential = pairing.received;
      // Poll approval intentionally omits platform. Verify the returned device
      // against Vantage before persisting, because the human can select Fusion.
      const { ok, data } = await request(pairing.origin, "/api/cad/relay/heartbeat", { cliVersion: "0.1.1" }, credential.deviceToken);
      const device = data.device;
      if (!ok || !record(device) || device.id !== credential.deviceId || device.orgId !== credential.orgId || device.userId !== credential.userId) {
        throw new Error("The approved device identity could not be verified. Check pairing again after resolving Vantage access.");
      }
      if (device.platform !== "onshape") { pending = undefined; throw new Error("That approval selected another CAD platform. Start pairing again and choose Onshape. The previous local pairing was not changed; remove the mistaken device in Vantage."); }
      assertActive();
      try { await options.save({ ...credential, platform: "onshape", baseUrl: pairing.origin.origin }); }
      catch { throw new Error("Device approval succeeded but its credential could not be saved. Fix credential storage, then check pairing again in this session; do not restart pairing."); }
      pending = undefined;
      return { status: "approval_required", message: "Pairing saved. Open Vantage Browser CAD, select this device and approve its pilot access. Then check connector status.", ...approval(credential, pairing.origin) };
    },
    dispose() { disposed = true; pending = undefined; },
  };
}
