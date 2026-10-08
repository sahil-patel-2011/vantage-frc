import { describe, expect, it, vi } from "vitest";
import { createOnshapeUiSetup } from "./setup";

const ORIGIN = "https://vantagefrc.vercel.app";
const POLL = "p".repeat(43);
const TOKEN = "t".repeat(43);
const DEVICE = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const credential = { deviceToken: TOKEN, deviceId: DEVICE, orgId: ORG, userId: "member", platform: "onshape", baseUrl: ORIGIN };
const issued = { userCode: "ABCD-EFGH", pollToken: POLL, verificationUri: `${ORIGIN}/cad/pair?code=ABCD-EFGH&platform=onshape`, expiresIn: 600, interval: 3 };
const approved = { status: "approved", deviceToken: TOKEN, deviceId: DEVICE, orgId: ORG, userId: "member" };
const heartbeat = { ok: true, device: { id: DEVICE, orgId: ORG, userId: "member", platform: "onshape" } };

function fixture(initial: Record<string, string> | null = null) {
  let time = 1_000;
  let stored = initial;
  const fetcher = vi.fn<typeof fetch>();
  const load = vi.fn(async () => stored);
  const save = vi.fn(async (next: Record<string, string>) => { stored = next; });
  const setup = createOnshapeUiSetup({ fetch: fetcher, load, save, signal: new AbortController().signal, now: () => time });
  const reply = (value: unknown, status = 200) => fetcher.mockResolvedValueOnce(new Response(JSON.stringify(value), { status }));
  return { setup, fetcher, load, save, reply, advance: (ms = 3_000) => { time += ms; }, stored: () => stored };
}

describe("explicit Vantage browser connector setup", () => {
  it("uses distinct nonidentifying machine labels across connector sessions", async () => {
    const first = fixture(); const second = fixture();
    first.reply(issued); second.reply(issued);
    await first.setup.pairStart({}); await second.setup.pairStart({});
    const label = (f: ReturnType<typeof fixture>) => JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body)).machineName;
    expect(label(first)).not.toBe(label(second));
    expect(label(first)).toMatch(/^Vantage browser [a-f0-9-]{36}$/);
    expect(label(first).length).toBeLessThanOrEqual(100);
  });
  it("does no IO at construction and reports missing pairing without starting network work", async () => {
    const f = fixture();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(await f.setup.status()).toMatchObject({ status: "pairing_required" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("returns only a public approval link, checks once after the minimum interval, and verifies before saving", async () => {
    const f = fixture();
    f.reply(issued);
    const begin = await f.setup.pairStart({});
    expect(begin.verificationUrl).toBe(issued.verificationUri);
    expect(JSON.stringify(begin)).not.toContain(POLL);
    await f.setup.status();
    await f.setup.pairCheck();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.advance(); f.reply(approved); f.reply(heartbeat);
    const finish = await f.setup.pairCheck();
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    expect(f.save).toHaveBeenCalledWith(credential);
    expect(finish).toMatchObject({ status: "approval_required", deviceId: DEVICE, approvalUrl: `${ORIGIN}/cad/browser-agent?orgId=${ORG}` });
    expect(JSON.stringify(finish)).not.toContain(TOKEN);
    const paths = f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual(["/api/cad/pair/start", "/api/cad/pair/poll", "/api/cad/relay/heartbeat"]);
    expect(f.fetcher.mock.calls.every(([, init]) => init?.redirect === "error")).toBe(true);
  });

  it("requires explicit replacement and keeps the old pairing when another platform was approved", async () => {
    const old = { ...credential, deviceToken: "o".repeat(43) };
    const f = fixture(old);
    await expect(f.setup.pairStart({})).rejects.toThrow("Ask the user");
    expect(f.fetcher).not.toHaveBeenCalled();
    f.reply(issued); await f.setup.pairStart({ replaceExisting: true });
    f.advance(); f.reply(approved); f.reply({ ...heartbeat, device: { ...heartbeat.device, platform: "fusion360" } });
    await expect(f.setup.pairCheck()).rejects.toThrow("choose Onshape");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.stored()).toEqual(old);
  });

  it("retries verification/storage after one-time poll consumption without polling that token again", async () => {
    const f = fixture();
    f.reply(issued); await f.setup.pairStart({}); f.advance();
    f.reply(approved); f.reply(heartbeat);
    f.save.mockRejectedValueOnce(new Error(`vault diagnostic ${TOKEN}`));
    await expect(f.setup.pairCheck()).rejects.toThrow("could not be saved");
    f.advance(); f.reply(heartbeat);
    expect(await f.setup.pairCheck()).toMatchObject({ status: "approval_required" });
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/pair/poll"))).toHaveLength(1);
    expect(f.save).toHaveBeenCalledTimes(2);
  });

  it("expires unused codes and never silently starts another pairing", async () => {
    const f = fixture(); f.reply(issued); await f.setup.pairStart({}); f.advance(600_001);
    await expect(f.setup.pairCheck()).rejects.toThrow("expired");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await expect(f.setup.pairCheck()).rejects.toThrow("Start pairing first");
  });

  it("refuses off-origin links, hidden secret query fields and incorrect platform links", async () => {
    for (const verificationUri of ["https://attacker.test/cad/pair?code=ABCD-EFGH", `${ORIGIN}/cad/pair?code=ABCD-EFGH&pollToken=${POLL}`, `${ORIGIN}/cad/pair?code=ABCD-EFGH&platform=fusion360`]) {
      const f = fixture(); f.reply({ ...issued, verificationUri });
      await expect(f.setup.pairStart({})).rejects.toThrow("unexpected approval link");
      expect(f.save).not.toHaveBeenCalled();
    }
  });

  it("allows legacy public approval links without platform and never leaks transport diagnostics", async () => {
    const f = fixture(); f.reply({ ...issued, verificationUri: `${ORIGIN}/cad/pair?code=ABCD-EFGH` });
    expect((await f.setup.pairStart({})).verificationUrl).toBe(issued.verificationUri);
    f.advance(); f.fetcher.mockRejectedValueOnce(new Error(`diagnostic contains ${POLL}`));
    await expect(f.setup.pairCheck()).rejects.toThrow("Vantage could not confirm");
  });

  it("does not authorize device pairing alone and checks current approval every time", async () => {
    const f = fixture(credential);
    f.reply({ allowed: false, reason: "team_sign_in_required" }, 403);
    expect(await f.setup.status()).toMatchObject({ status: "approval_required" });
    f.reply({ allowed: true, status: "eligible", transport: "onshape_browser_ui" });
    expect(await f.setup.authorize()).toEqual(credential);
    f.reply({ allowed: false, reason: "pilot_membership_required" }, 403);
    await expect(f.setup.authorize()).rejects.toThrow("Current membership");
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    f.setup.dispose();
    await expect(f.setup.pairStart({})).rejects.toThrow("closed");
  });
});
