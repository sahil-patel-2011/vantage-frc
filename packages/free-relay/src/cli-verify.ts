/**
 * Live verification for the free relay (FreeBuff/Codebuff proxy).
 *
 * Proves the chain Vantage actually uses, not a hand-rolled curl: the non-streaming
 * check runs through `tryCreateFreeRelayAdapter` + `HttpChatAdapter`, so a pass means
 * production code can talk to this relay, including response-shape parsing.
 *
 * Also captures the SSE wire format verbatim. Vantage has no streaming today; the
 * chunk shape recorded here is what a `completeStream` parser has to match, and
 * guessing it from vendor docs is how you ship a parser against a format nobody has.
 *
 *   npm run free-relay:verify
 *
 * Never prints the relay key or the upstream FreeBuff token.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFreeRelayConfig, tryCreateFreeRelayAdapter } from "@vantage/agent";

const PRIMARY_ENV_FILE = ".env.free-relay";
const ENV_FILES = [PRIMARY_ENV_FILE, ".env.production.local", ".env.migrate.local"];

/**
 * npm runs a workspace script with the CWD set to the package, not the repo — so a
 * bare relative path would miss the .env.free-relay the Pi installer writes at the
 * root. Walk up to the workspace root instead.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown }).workspaces) {
          return dir;
        }
      } catch {
        // Unreadable manifest on the way up is not fatal; keep climbing.
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function loadEnvFiles(): NodeJS.ProcessEnv {
  const root = repoRoot();
  const fileEnv: Record<string, string> = {};
  for (const name of ENV_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      let value = line.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fileEnv[line.slice(0, i).trim()] = value;
    }
  }
  // Explicit shell variables win over files, matching scripts/run-migrations.mjs.
  return { ...fileEnv, ...process.env };
}

let failures = 0;
let warnings = 0;

function pass(label: string, detail = ""): void {
  console.log(`  \x1b[32mPASS\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail = ""): void {
  failures += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
}
function warn(label: string, detail = ""): void {
  warnings += 1;
  console.log(`  \x1b[33mWARN\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : null;
  return code ? `${error.message} (${code})` : error.message;
}

/**
 * Returns the intended exit code rather than calling process.exit(). Exiting while an
 * SSE response socket is still tearing down trips a libuv assertion on Windows, which
 * replaces a clean `1` with a 0xC0000409 abort — a useless signal for a script chain.
 */
async function main(): Promise<number> {
  const env = loadEnvFiles();

  section("Configuration");
  const config = readFreeRelayConfig(env);
  if (!config) {
    if (!env.FREE_RELAY_BASE_URL?.trim()) {
      fail(
        "FREE_RELAY_BASE_URL is unset",
        `set it in ${join(repoRoot(), PRIMARY_ENV_FILE)} or the shell`,
      );
    } else {
      fail(
        "relay refused",
        "base URL is not loopback/LAN and FREE_RELAY_API_KEY is unset — an internet-reachable relay must carry a key",
      );
    }
    console.log("\nNothing to verify. See docs/FREE_RELAY_PI.md.");
    return 1;
  }
  pass("relay config resolved", `${config.providerLabel} @ ${config.baseUrl}`);
  pass("model", config.model);

  const authHeader = { Authorization: `Bearer ${config.apiKey}` };

  section("Reachability");
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: authHeader,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      fail("GET /v1/models", `HTTP ${response.status}`);
    } else {
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      const models = (payload.data ?? []).map((m) => m.id ?? "").filter(Boolean);
      pass("GET /v1/models", `${models.length} model(s)`);
      if (models.length) {
        console.log(`       ${models.slice(0, 12).join(", ")}${models.length > 12 ? ", …" : ""}`);
      }
      if (models.length && !models.includes(config.model)) {
        // The single most common misconfiguration: the slug differs between proxy
        // projects (deepseek/deepseek-v4-flash vs deepseek-v4-flash-free).
        warn(
          `FREE_RELAY_MODEL "${config.model}" is not in the relay's catalog`,
          "the proxy may coerce it, or every request may 404",
        );
      }
    }
  } catch (error) {
    fail("GET /v1/models", describeError(error));
    console.log("\nThe relay is not answering. Start the proxy, then re-run.");
    return 1;
  }

  section("Authentication");
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      fail(
        "keyless request was accepted",
        "this relay is an open pass-through to your FreeBuff account — set API_KEYS on the proxy",
      );
    } else {
      pass("keyless request refused", `HTTP ${response.status}`);
    }
  } catch (error) {
    // A connection-level rejection is also a refusal.
    pass("keyless request refused", describeError(error));
  }

  section("Non-streaming completion through Vantage's own adapter");
  const adapter = tryCreateFreeRelayAdapter({ env, capability: "chat" });
  if (!adapter) {
    fail("adapter construction", "tryCreateFreeRelayAdapter returned null");
  } else {
    try {
      const started = Date.now();
      const result = await adapter.complete({
        message: "Reply with exactly: VANTAGE_RELAY_OK",
        context: [],
      });
      const elapsed = Date.now() - started;
      const text = result.text.trim();
      if (text.includes("VANTAGE_RELAY_OK")) {
        pass("completion", `${elapsed}ms, ${result.completionTokens} completion token(s)`);
      } else {
        // Still a pass for wiring: bytes came back and parsed. The model just rambled.
        pass("completion parsed", `${elapsed}ms — model did not echo verbatim`);
        console.log(`       got: ${text.slice(0, 160)}`);
      }
      if (result.promptTokens === 0 && result.completionTokens === 0) {
        warn(
          "no token usage reported",
          "the relay omits `usage`, so the ledger will record zeros for this path",
        );
      }
    } catch (error) {
      fail("completion", describeError(error));
    }
  }

  section("Streaming wire format (capture for the completeStream parser)");
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Count from 1 to 20, separated by spaces." }],
        stream: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      fail("streaming POST", `HTTP ${response.status}`);
    } else if (!response.body) {
      fail("streaming POST", "no response body to read");
    } else {
      const contentType = response.headers.get("content-type") ?? "(none)";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const firstChunks: string[] = [];
      let chunkCount = 0;
      let bytes = 0;
      let firstByteMs: number | null = null;
      const started = Date.now();

      while (chunkCount < 400) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByteMs === null) firstByteMs = Date.now() - started;
        chunkCount += 1;
        bytes += value?.byteLength ?? 0;
        const text = decoder.decode(value, { stream: true });
        if (firstChunks.length < 6) firstChunks.push(text);
      }
      await reader.cancel().catch(() => undefined);

      if (chunkCount <= 1) {
        // One chunk means the proxy buffered the whole answer — technically SSE, but
        // it would not actually feel incremental in the UI.
        warn(
          "response arrived as a single chunk",
          "the relay is not incrementally flushing; streaming would not feel live",
        );
      } else {
        pass(
          "incremental streaming",
          `${chunkCount} chunks, ${bytes} bytes, first byte ${firstByteMs}ms`,
        );
      }
      pass("content-type", contentType);

      console.log("\n       --- first chunks verbatim ---");
      for (const chunk of firstChunks) {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) console.log(`       | ${line.slice(0, 200)}`);
        }
      }
      console.log("       --- end ---");

      const joined = firstChunks.join("");
      if (joined.includes("data:")) {
        pass("SSE framing", "`data:` lines present — standard OpenAI chunk framing");
      } else {
        warn("SSE framing", "no `data:` prefix seen; the parser will need a custom shape");
      }
    }
  } catch (error) {
    fail("streaming POST", describeError(error));
  }

  section("Verdict");
  if (failures > 0) {
    console.log(`  ${failures} failure(s), ${warnings} warning(s). See docs/FREE_RELAY_PI.md.`);
    return 1;
  }
  console.log(`  All checks passed${warnings ? `, ${warnings} warning(s)` : ""}.`);
  console.log("  Vantage's own adapter can drive this relay.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\nverify-free-relay crashed: ${describeError(error)}`);
    process.exitCode = 1;
  });
