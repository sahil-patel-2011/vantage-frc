/**
 * Why can't Vantage reach its database? Turn a node-postgres / Node error into one sentence
 * of what failed, one of why, and one of what to try — the three lines the owner reads in the
 * outage email and on the outage console.
 *
 * Pure: no I/O, no env reads except the one passed in. The output never carries a password,
 * a connection string or a full host name: hosts are masked (`va***.example.ddns.net`) and an
 * unrecognised error's message is scrubbed before it is kept.
 */

export type OutageCode =
  | "connection_refused"
  | "unreachable"
  | "dns"
  | "tls"
  | "auth"
  | "too_many_connections"
  | "disk_full"
  | "read_only"
  | "shutting_down"
  | "starting_up"
  | "database_missing"
  | "connection_lost"
  | "not_configured"
  | "backup_mode"
  | "unknown";

export type OutageClassification = {
  code: OutageCode;
  /** Short headline: "Postgres isn't accepting connections". */
  title: string;
  /** Plain explanation of the likely cause. */
  why: string;
  /** What the owner can try first. */
  fix: string;
  /** The machine code that decided it (ECONNREFUSED, SQLSTATE 28P01), never a message. */
  errorCode: string | null;
  /** Masked host (and port) when the error named one. */
  host: string | null;
  /** Scrubbed message excerpt, kept only for `unknown` so there is something to search for. */
  detail: string | null;
};

type ErrorFacts = {
  codes: string[];
  messages: string[];
  address: string | null;
  hostname: string | null;
  port: number | null;
};

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const UNREACHABLE_CODES = new Set(["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENETDOWN", "ECONNABORTED"]);
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]);
const LOST_CODES = new Set(["ECONNRESET", "EPIPE"]);

/** Postgres SQLSTATE: five characters, class first (digits, or F0/HV/P0/XX). */
function isSqlState(code: string) {
  return /^[0-9][0-9A-Z]{4}$/.test(code) || /^(F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code);
}

/**
 * Walk the error, its `cause` chain and AggregateError members (Node's happy-eyeballs connect
 * throws one AggregateError for the IPv4 and IPv6 attempts together).
 */
function collectFacts(error: unknown): ErrorFacts {
  const facts: ErrorFacts = { codes: [], messages: [], address: null, hostname: null, port: null };
  const seen = new Set<unknown>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  while (queue.length && seen.size < 16) {
    const { value, depth } = queue.shift()!;
    if (value == null || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "string") {
      facts.messages.push(value);
      continue;
    }
    if (typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && record.code) facts.codes.push(record.code);
    if (typeof record.message === "string" && record.message) facts.messages.push(record.message);
    if (!facts.address && typeof record.address === "string") facts.address = record.address;
    if (!facts.hostname && typeof record.hostname === "string") facts.hostname = record.hostname;
    if (facts.port == null && typeof record.port === "number") facts.port = record.port;
    if (depth >= 5) continue;
    if ("cause" in record) queue.push({ value: record.cause, depth: depth + 1 });
    if (Array.isArray(record.errors)) for (const inner of record.errors.slice(0, 4)) queue.push({ value: inner, depth: depth + 1 });
  }
  return facts;
}

/** Keep enough of a host to recognise it, not enough to hand someone the address. */
export function maskHost(host: string | null | undefined): string | null {
  const value = host?.trim().replace(/^\[|\]$/g, "");
  if (!value) return null;
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") return value;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(value);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.*.*`;
  if (value.includes(":")) return `${value.split(":")[0] || ""}:…`;
  const labels = value.split(".").filter(Boolean);
  if (!labels.length) return null;
  const first = `${labels[0]!.slice(0, 2)}***`;
  return labels.length === 1 ? first : [first, ...labels.slice(1)].join(".");
}

function isLoopback(address: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

/**
 * An unrecognised error's message is the only clue, so a short, scrubbed excerpt is kept:
 * connection strings, `password=` pairs and the host itself are removed first.
 */
export function scrubMessage(message: string, facts?: Pick<ErrorFacts, "address" | "hostname">): string {
  let text = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[connection string removed]")
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*\S+/gi, "$1=[removed]")
    .replace(/\s+/g, " ")
    .trim();
  for (const host of [facts?.hostname, facts?.address]) {
    if (host && host.length > 3) text = text.split(host).join(maskHost(host) ?? "[host]");
  }
  return text.slice(0, 180);
}

function hostLabel(facts: ErrorFacts) {
  const masked = maskHost(facts.hostname ?? facts.address);
  if (!masked) return null;
  return facts.port ? `${masked}:${facts.port}` : masked;
}

function result(
  code: OutageCode,
  title: string,
  why: string,
  fix: string,
  facts: ErrorFacts,
  errorCode: string | null,
  detail: string | null = null,
): OutageClassification {
  return { code, title, why, fix, errorCode, host: hostLabel(facts), detail };
}

function tlsClassification(facts: ErrorFacts, errorCode: string | null): OutageClassification {
  const text = facts.messages.join(" ");
  const code = errorCode ?? "TLS";
  if (code === "CERT_HAS_EXPIRED" || /certificate has expired/i.test(text)) {
    return result(
      "tls",
      "The database certificate has expired",
      "The NAS's server certificate is past its end date, so Vantage refuses to connect to it (it never connects without checking).",
      "Issue a new server.crt with the same certificate authority (docs/NAS_DATABASE.md, step 1), put it in the Postgres certs folder and restart the container. Vercel needs no change while the CA stays the same.",
      facts,
      code,
    );
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || /does not match certificate|altnames/i.test(text)) {
    return result(
      "tls",
      "The database certificate is for a different name",
      "The name in the database URL is not the name the NAS's certificate was made for, so the connection is refused.",
      "Use the same DDNS name in DATABASE_URL that you put in the certificate (subjectAltName), or reissue server.crt for the name you now use.",
      facts,
      code,
    );
  }
  if (/does not support SSL/i.test(text)) {
    return result(
      "tls",
      "The database isn't offering encryption",
      "Postgres on the NAS answered without TLS. Vantage never sends passwords unencrypted, so it stops there.",
      "Check the Postgres container still starts with ssl=on and the certificate files mounted (docs/NAS_DATABASE.md, step 2).",
      facts,
      code,
    );
  }
  return result(
    "tls",
    "The database certificate isn't trusted",
    "The NAS's certificate wasn't signed by the certificate authority Vantage was given, or no authority was given (a self-signed certificate looks the same).",
    "Check that DATABASE_SSL_CA in Vercel holds nas-ca.pem (or its base64) and that the NAS still serves the server.crt that CA signed.",
    facts,
    code,
  );
}

function sqlStateClassification(state: string, facts: ErrorFacts): OutageClassification | null {
  const errorCode = `SQLSTATE ${state}`;
  if (state === "28P01" || state === "28000") {
    return result(
      "auth",
      "The database refused Vantage's login",
      "Postgres is running but rejected the app's username or password, or its access rules (pg_hba.conf) no longer allow this connection.",
      "Check the password in DATABASE_URL matches the one set with ALTER ROLE vantage_app, and that pg_hba.conf still allows vantage_app with scram-sha-256 from outside.",
      facts,
      errorCode,
    );
  }
  if (state === "53300") {
    return result(
      "too_many_connections",
      "The database has run out of connections",
      "Postgres reached its connection limit. Many app instances at once, a stuck script or a backup tool can hold them all.",
      "Restart the Postgres container to drop them. If it happens again, look at who is connected: SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1.",
      facts,
      errorCode,
    );
  }
  if (state === "53100") {
    return result(
      "disk_full",
      "The NAS disk is full",
      "Postgres can't write because the volume holding its data has no space left.",
      "Free space on that NAS volume (old snapshots, backups, logs), then restart the Postgres container.",
      facts,
      errorCode,
    );
  }
  if (state === "25006") {
    return readOnly(facts, errorCode);
  }
  if (state === "57P01" || state === "57P02") {
    return result(
      "shutting_down",
      "Postgres is shutting down",
      "The database server is stopping — the container was stopped or restarted, or the NAS is shutting down or updating.",
      "Wait a minute and check the container is running again. If the NAS is installing updates, it comes back on its own.",
      facts,
      errorCode,
    );
  }
  if (state === "57P03") {
    return result(
      "starting_up",
      "Postgres is still starting up",
      "The database server is running but not ready yet, often while it recovers after a power cut.",
      "Give it a few minutes. If it stays like this, read the Postgres container's log for recovery errors.",
      facts,
      errorCode,
    );
  }
  if (state === "3D000") {
    return result(
      "database_missing",
      "The database doesn't exist",
      "Postgres is up, but the database named in the URL isn't there — usually a container that started without its data folder.",
      "Check the Postgres container still mounts its data folder, and that the database name in DATABASE_URL is right (normally vantage).",
      facts,
      errorCode,
    );
  }
  if (state.startsWith("08")) {
    return lost(facts, errorCode);
  }
  return null;
}

function readOnly(facts: ErrorFacts, errorCode: string | null) {
  return result(
    "read_only",
    "The database is read-only",
    "Postgres is refusing writes: it is a standby copy, it was set read-only, or it went read-only after a disk problem.",
    "Make sure DATABASE_URL points at the main server, that default_transaction_read_only is off, and check the NAS disk health.",
    facts,
    errorCode,
  );
}

function lost(facts: ErrorFacts, errorCode: string | null) {
  return result(
    "connection_lost",
    "The connection to the NAS dropped",
    "The NAS or the network between it and Vercel cut an open connection — often a router reboot, an internet blip, or Postgres restarting.",
    "If it keeps happening, check the NAS's uptime and the router's log. A UPS on both helps.",
    facts,
    errorCode,
  );
}

/**
 * Classify a database failure. Order matters: a server's own answer (SQLSTATE) beats a TLS
 * failure, which beats DNS, which beats "refused", which beats a timeout.
 */
export function classifyDatabaseFailure(
  error: unknown,
  env: { NODE_ENV?: string } = { NODE_ENV: process.env.NODE_ENV },
): OutageClassification {
  const facts = collectFacts(error);
  const text = facts.messages.join(" \n ");

  // VANTAGE_BACKUP_MODE (packages/db/src/backup-mode.ts): disconnected on purpose, not broken.
  if (facts.codes.includes("VANTAGE_BACKUP_MODE")) {
    return result(
      "backup_mode",
      "Backup mode is on",
      "VANTAGE_BACKUP_MODE is set, so Vantage connects to no database on purpose and teams use their Google Sheets copy.",
      "When the NAS is connected, remove VANTAGE_BACKUP_MODE in Vercel → Settings → Environment Variables and redeploy.",
      facts,
      "VANTAGE_BACKUP_MODE",
    );
  }

  for (const code of facts.codes) {
    if (isSqlState(code)) {
      const classified = sqlStateClassification(code, facts);
      if (classified) return classified;
    }
  }
  if (/read[- ]only transaction/i.test(text)) return readOnly(facts, facts.codes.find(isSqlState) ?? null);
  if (/the database system is shutting down/i.test(text)) return sqlStateClassification("57P01", facts)!;
  if (/the database system is (starting up|in recovery mode)/i.test(text)) return sqlStateClassification("57P03", facts)!;
  if (/password authentication failed|no pg_hba\.conf entry/i.test(text)) return sqlStateClassification("28P01", facts)!;
  if (/too many clients already|remaining connection slots are reserved/i.test(text)) return sqlStateClassification("53300", facts)!;
  if (/database "[^"]*" does not exist/i.test(text)) return sqlStateClassification("3D000", facts)!;

  const tls = facts.codes.find((code) => TLS_CODES.has(code) || code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_"));
  if (tls || /self[- ]signed certificate|certificate has expired|unable to verify the first certificate|does not support SSL connections|altnames/i.test(text)) {
    return tlsClassification(facts, tls ?? null);
  }

  const dns = facts.codes.find((code) => DNS_CODES.has(code));
  if (dns || /getaddrinfo (ENOTFOUND|EAI_AGAIN)/.test(text)) {
    return result(
      "dns",
      "The NAS's address doesn't resolve",
      "The DNS name in the database URL doesn't point anywhere right now — usually the dynamic DNS (DDNS) name expired or stopped updating, or the DNS service is down.",
      "Open the DDNS settings on the NAS or router and check the name is still registered and shows your current public IP.",
      facts,
      dns ?? "ENOTFOUND",
    );
  }

  if (facts.codes.includes("ECONNREFUSED") || /\bECONNREFUSED\b/.test(text)) {
    if (env.NODE_ENV === "production" && isLoopback(facts.address)) {
      return result(
        "not_configured",
        "The app has no database address",
        "The deployment is trying to reach a database on its own server, which means DATABASE_URL isn't set for this environment.",
        "In Vercel → Settings → Environment Variables, set DATABASE_URL and DATABASE_AUTH_URL for Production (docs/NAS_DATABASE.md, step 4) and redeploy.",
        facts,
        "ECONNREFUSED",
      );
    }
    return result(
      "connection_refused",
      "Postgres isn't accepting connections",
      "The NAS is reachable, but nothing is listening on the database port: the Postgres container is stopped, crashed, or the port forward points at the wrong place.",
      "Open the NAS's container app and start the Postgres container. If it keeps stopping, read its log (a full disk or a bad setting are the usual causes).",
      facts,
      "ECONNREFUSED",
    );
  }

  const unreachable = facts.codes.find((code) => UNREACHABLE_CODES.has(code));
  if (
    unreachable ||
    /timeout expired|timeout exceeded when trying to connect|connection timeout|timed out|did not answer within/i.test(text)
  ) {
    return result(
      "unreachable",
      "The NAS can't be reached",
      "Connections to the NAS get no answer: it is off or asleep, it lost its internet connection, or the router stopped forwarding the database port to it.",
      "Check the NAS has power and internet, then that the router still forwards the database port to it. Test from outside your network (a phone hotspot) with psql.",
      facts,
      unreachable ?? "ETIMEDOUT",
    );
  }

  const lostCode = facts.codes.find((code) => LOST_CODES.has(code));
  if (lostCode || /connection terminated|server closed the connection unexpectedly|socket hang up/i.test(text)) {
    return lost(facts, lostCode ?? null);
  }

  const errorCode = facts.codes[0] ? (isSqlState(facts.codes[0]) ? `SQLSTATE ${facts.codes[0]}` : facts.codes[0]) : null;
  const message = facts.messages[0];
  return result(
    "unknown",
    "Unrecognised database error",
    "Vantage couldn't use its database, and the error didn't match a cause it knows.",
    "Read the Postgres container's log on the NAS around the time below, and check the NAS is online.",
    facts,
    errorCode,
    message ? scrubMessage(message, facts) : null,
  );
}

/**
 * True when the error says the database itself is unavailable (connection, login, server
 * state) — not a bug in a query, a missing session, or a refused permission. /api/me uses
 * this so an ordinary failure doesn't page the owner.
 */
export function isDatabaseFailure(error: unknown): boolean {
  if (error == null) return false;
  return classifyDatabaseFailure(error, { NODE_ENV: "test" }).code !== "unknown";
}
