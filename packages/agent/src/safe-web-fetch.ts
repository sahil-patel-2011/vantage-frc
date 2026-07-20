/**
 * SSRF-safe HTTPS fetch for autonomous agent web tools.
 * Blocks private/metadata IPs, requires https, size/time limits, host allowlist.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const WEB_FETCH_MAX_BYTES = 500_000;
export const WEB_FETCH_TIMEOUT_MS = 10_000;
export const WEB_EXCERPT_MAX_CHARS = 8_000;

/** Public FRC / competition docs hosts the agent may fetch. */
export const WEB_FETCH_HOST_ALLOWLIST: readonly string[] = [
  "www.firstinspires.org",
  "firstinspires.org",
  "www.thebluealliance.com",
  "thebluealliance.com",
  "www.statbotics.io",
  "statbotics.io",
  "api.statbotics.io",
  "frc-docs.readthedocs.io",
  "docs.wpilib.org",
  "github.com",
  "raw.githubusercontent.com",
  "frc-events.firstinspires.org",
  "www.first.org",
  "first.org",
];

export function isBlockedPrivateIp(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function isAllowlistedFetchHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return WEB_FETCH_HOST_ALLOWLIST.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export function isWebBrowseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.AGENT_WEB_BROWSE_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/**
 * Validate a candidate fetch URL: https only, allowlisted host, no credentials,
 * DNS resolves to non-private addresses.
 */
export async function assertSafeFetchUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new Error("Only https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("Credentials must not be embedded in URLs");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local and internal hosts are blocked");
  }
  if (!isAllowlistedFetchHost(host)) {
    throw new Error(`Host is not on the autonomous-agent fetch allowlist: ${host}`);
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedPrivateIp(address))) {
    throw new Error("Private, metadata, and local-network targets are blocked");
  }
  return url;
}

export type SafeFetchResult = {
  url: string;
  finalUrl: string;
  contentType: string | null;
  excerpt: string;
  truncated: boolean;
  byteLength: number;
};

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function safeAllowlistedFetch(
  rawUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    maxBytes?: number;
    timeoutMs?: number;
    maxExcerptChars?: number;
  } = {},
): Promise<SafeFetchResult> {
  if (!isWebBrowseEnabled()) {
    throw new Error("setup_required: Agent web browse is disabled (AGENT_WEB_BROWSE_ENABLED)");
  }
  const url = await assertSafeFetchUrl(rawUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? WEB_FETCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const maxExcerpt = options.maxExcerptChars ?? WEB_EXCERPT_MAX_CHARS;

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html,text/plain,application/json,text/markdown;q=0.9,*/*;q=0.5" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  // Re-validate after redirects (SSRF via open redirect).
  const finalUrl = await assertSafeFetchUrl(response.url || url.toString());
  if (!response.ok) {
    throw new Error(`Fetch failed (HTTP ${response.status})`);
  }
  const contentType = response.headers.get("content-type");
  if (contentType && /pdf|octet-stream|image\/|audio\/|video\//i.test(contentType)) {
    throw new Error("Binary/PDF content is not fetched — use a text or HTML docs URL");
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const plain =
    contentType && /html/i.test(contentType) ? stripHtmlToText(rawText) : rawText.trim();
  const truncated = plain.length > maxExcerpt;
  return {
    url: url.toString(),
    finalUrl: finalUrl.toString(),
    contentType,
    excerpt: plain.slice(0, maxExcerpt),
    truncated,
    byteLength: buffer.byteLength,
  };
}
