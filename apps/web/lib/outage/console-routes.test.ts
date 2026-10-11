import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The outage console's API, as the owner uses it while the database is down: the signed link
 * is the only authorization, nothing touches the database except the live probe, and email goes
 * through the configured provider (a fake here).
 */
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }>, name: "resend" }));

vi.mock("@vantage/core", () => ({
  createEmailProvider: () => ({
    name: mail.name,
    sendFreeform: async (message: { to: string; subject: string; text: string }) => {
      mail.sent.push(message);
    },
  }),
  resolveAuthBaseURL: () => "https://vantage.test",
}));
vi.mock("@vantage/db", () => ({
  withRls: async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED" });
  },
}));

const { MemoryOutageStore, setOutageStoreForTests } = await import("./status-store");
const { signConsoleToken } = await import("./console-token");
const { saveRecipientSnapshot } = await import("./recipients");
const { readNotice } = await import("./notice");
const { readBroadcastJob } = await import("./broadcast");
const { GET } = await import("../../app/api/status/outage/route");
const broadcast = await import("../../app/api/status/outage/broadcast/route");
const banner = await import("../../app/api/status/outage/banner/route");

let store: InstanceType<typeof MemoryOutageStore>;
let token: string;
let incidentCounter = 0;

function post(handler: (request: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request("https://vantage.test/api/status/outage/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ token, ...body }),
    }),
  );
}

const limited = {
  kind: "limited",
  audience: "everyone",
  subject: "Vantage is running with limited features",
  message: "Vantage is running with limited features while we fix a server problem.",
  confirm: "SEND",
};

/** The send runs in the background (after() falls back to "now" outside a request). */
async function settle(count: number) {
  for (let waited = 0; mail.sent.length < count && waited < 10_000; waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("outage console API", () => {
  beforeEach(() => {
    store = new MemoryOutageStore();
    setOutageStoreForTests(store);
    mail.sent = [];
    mail.name = "resend";
    vi.stubEnv("PLATFORM_OWNER_EMAIL", "owner@example.com");
    // A fresh incident per test, so per-incident rate limits never carry over.
    token = signConsoleToken(`incident_${++incidentCounter}`)!;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a missing or forged link", async () => {
    const response = await GET(new Request("https://vantage.test/api/status/outage"));
    expect(response.status).toBe(401);
    const forged = await GET(
      new Request("https://vantage.test/api/status/outage", { headers: { authorization: `Bearer ${token.slice(0, -2)}xx` } }),
    );
    expect(forged.status).toBe(401);
  });

  it("shows the live status and says plainly when there is no contact list", async () => {
    const response = await GET(new Request("https://vantage.test/api/status/outage", { headers: { authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.live.database).toBe("unreachable");
    expect(body.contacts).toBeNull();
    expect(body.notice).toEqual({ limited: false });
    expect(body.ownerConfigured).toBe(true);
    expect(body.defaults.limited.message).toMatch(/keeps saving on your phone/);
    expect(response.headers.get("cache-control")).toContain("no-store");

    const refused = await post(broadcast.POST, limited);
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("no_contact_list");

    // The fallback: only the owner. A test email changes nothing anyone else sees.
    const owner = await post(broadcast.POST, { ...limited, audience: "owner" });
    expect(owner.status).toBe(200);
    expect(mail.sent.map((row) => row.to)).toEqual(["owner@example.com"]);
    expect(await readNotice(store)).toBeNull();
  });

  it("emails everyone on the saved list once, turns the banner on, and needs 'send again' for a second time", async () => {
    await saveRecipientSnapshot(store, ["coach@example.com", "student@example.org"]);
    const missingConfirm = await post(broadcast.POST, { ...limited, confirm: "yes" });
    expect(missingConfirm.status).toBe(400);

    const first = await post(broadcast.POST, limited);
    expect(first.status).toBe(202);
    expect((await first.json()).bannerOn).toBe(true);
    // A second run while the first is still sending would email everyone twice.
    const overlapping = await post(broadcast.POST, { ...limited, again: true });
    expect(overlapping.status).toBe(409);
    expect((await overlapping.json()).code).toBe("in_progress");
    await settle(3);
    expect(mail.sent.map((row) => row.to).sort()).toEqual(["coach@example.com", "owner@example.com", "student@example.org"]);
    expect(mail.sent.every((row) => row.subject === limited.subject)).toBe(true);
    const notice = await readNotice(store);
    expect(notice?.message).toBe(limited.message);
    const incidentId = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).incidentId;
    expect(await readBroadcastJob(store, incidentId, "limited")).toMatchObject({ sent: 3, total: 3 });

    const repeat = await post(broadcast.POST, limited);
    expect(repeat.status).toBe(409);
    expect((await repeat.json()).code).toBe("already_sent");

    const again = await post(broadcast.POST, { ...limited, again: true });
    expect(again.status).toBe(202);
    await settle(6);
    expect(mail.sent).toHaveLength(6);
  });

  it("the 'back' email turns the banner off; the banner switch works on its own too", async () => {
    await saveRecipientSnapshot(store, ["coach@example.com"]);
    const on = await post(banner.POST, { on: true, message: "We're fixing a server problem." });
    expect(await on.json()).toEqual({ notice: expect.objectContaining({ limited: true, message: "We're fixing a server problem." }) });

    const back = await post(broadcast.POST, { ...limited, kind: "recovered", subject: "Vantage is working normally again" });
    expect(back.status).toBe(202);
    expect(await readNotice(store)).toBeNull();

    await post(banner.POST, { on: true });
    const off = await post(banner.POST, { on: false });
    expect(await off.json()).toEqual({ notice: { limited: false } });
  });

  it("says what to configure when email isn't set up", async () => {
    mail.name = "unconfigured";
    const response = await post(broadcast.POST, { ...limited, audience: "owner" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/RESEND_API_KEY/);
  });
});
