/**
 * Sign in as the platform owner, make sure team 6925 has Freebuff, send a chat.
 * Never prints secrets, passwords, or cookies.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const ROOT = new URL("../", import.meta.url);
const env = parseEnv(new URL("apps/web/.env.local", ROOT));
for (const [key, value] of Object.entries(env)) {
  if (!process.env[key]) process.env[key] = value;
}

const BASE = "http://localhost:3001";
const preferredEmail = "sahiljpatel2011@gmail.com";

function localOtp(email, type = "sign-in") {
  const secret = env.DEV_OTP_SECRET || "vantage-local-otp";
  const digest = createHmac("sha256", secret)
    .update(`${email.trim().toLowerCase()}:${type}`)
    .digest()
    .readUInt32BE(0);
  return String(digest % 1_000_000).padStart(6, "0");
}

const dbUrl = [env.DATABASE_URL, env.DATABASE_AUTH_URL, env.DATABASE_ADMIN_URL, env.POSTGRES_URL]
  .map((value) => (value ?? "").trim())
  .find((value) => /^postgres(ql)?:\/\//i.test(value));
if (!dbUrl) {
  console.error("no postgres URL in apps/web/.env.local");
  process.exit(1);
}
const sql = neon(dbUrl);

function parseEnv(url) {
  const values = {};
  for (const raw of readFileSync(url, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

function cookieJar(response, previous = "") {
  const set = response.headers.getSetCookie?.() ?? [];
  const map = new Map();
  for (const part of previous.split(";").map((item) => item.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const header of set) {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function json(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: BASE,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 240) };
  }
  return { status: response.status, data, cookie: cookieJar(response, cookie) };
}

const orgs = await sql`
  SELECT o.id, o.name, o.team_number,
         EXISTS (
           SELECT 1 FROM org_ai_access_grants g
            WHERE g.org_id = o.id
              AND g.access_kind = 'platform_relay'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND g.ends_at > now()
         ) AS has_grant
    FROM organizations o
   WHERE o.team_number = 6925
   ORDER BY o.created_at
   LIMIT 3
`;
if (!orgs.length) {
  console.error("No organization with team_number 6925");
  process.exit(1);
}
const org = orgs[0];
console.log(`org ${org.name} team=${org.team_number} grant=${org.has_grant}`);

const members = await sql`
  SELECT u.id, u.email
    FROM memberships m
    JOIN users u ON u.id = m.user_id
   WHERE m.org_id = ${org.id}::uuid
   ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.created_at
   LIMIT 8
`;
if (!members.length) {
  console.error("team 6925 has no members");
  process.exit(1);
}
const member =
  members.find((row) => String(row.email).toLowerCase() === preferredEmail) ?? members[0];
const email = String(member.email).trim().toLowerCase();
const actorId = member.id;
console.log(`member_count=${members.length} using_preferred=${email === preferredEmail}`);

if (!org.has_grant) {
  if (!actorId) {
    console.error("no actor for grant");
    process.exit(1);
  }
  await sql`
    INSERT INTO org_ai_access_grants(org_id, access_kind, ends_at, granted_by, note)
    VALUES (${org.id}::uuid, 'platform_relay', now() + interval '365 days', ${actorId}::uuid, 'Team 6925 default-fast Freebuff')
  `;
  console.log("granted platform_relay");
}

const sent = await json("/api/auth/email-otp/send-verification-otp", {
  method: "POST",
  body: { email, type: "sign-in" },
});
if (sent.status >= 400) {
  console.error(`otp send failed status=${sent.status} error=${sent.data?.message ?? sent.data?.error ?? "unknown"}`);
  process.exit(1);
}
const signIn = await json("/api/auth/sign-in/email-otp", {
  method: "POST",
  cookie: sent.cookie,
  body: { email, otp: localOtp(email, "sign-in") },
});
if (signIn.status >= 400) {
  console.error(`otp sign-in failed status=${signIn.status} error=${signIn.data?.message ?? signIn.data?.error ?? "unknown"}`);
  process.exit(1);
}
const cookie = signIn.cookie;
console.log("signed in");

const funding = await json(`/api/team/ai-funding?orgId=${org.id}`, { cookie });
const models = (funding.data?.freebuffModels ?? []).map((model) => model.slug);
console.log(`funding status=${funding.status} models=${models.join(",") || "none"} selected=${funding.data?.freebuffModel ?? "none"}`);

const thread = await json("/api/agent", {
  method: "POST",
  cookie,
  body: { action: "thread", orgId: org.id, scope: "private", title: "Freebuff live check" },
});
if (thread.status >= 400 || !thread.data?.threadId) {
  console.error(`thread failed status=${thread.status} error=${thread.data?.error ?? thread.data?.message ?? "unknown"}`);
  process.exit(1);
}
console.log("thread created");

const chat = await json("/api/agent", {
  method: "POST",
  cookie,
  body: {
    action: "message",
    orgId: org.id,
    threadId: thread.data.threadId,
    scope: "private",
    message: "Reply with exactly the word pong and nothing else.",
  },
});
const reply = String(chat.data?.text ?? chat.data?.reply ?? chat.data?.content ?? "").slice(0, 200);
console.log(`chat status=${chat.status} provider=${chat.data?.provider ?? "?"} model=${chat.data?.model ?? "?"} reply=${JSON.stringify(reply)}`);
if (chat.status >= 400) {
  console.error(`chat error=${chat.data?.error ?? chat.data?.message ?? chat.data?.code ?? "unknown"}`);
  process.exit(1);
}
