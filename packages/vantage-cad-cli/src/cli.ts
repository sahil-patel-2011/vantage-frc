#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { hostname, platform as osPlatform } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import {
  clearDeviceCredential,
  credentialStorageStatus,
  loadDeviceCredential,
  saveDeviceCredential,
} from "./secure-store";
import {
  DEFAULT_FUSION_PLUGIN_ENDPOINT,
  detectFusionPrerequisites,
  openBrowser,
  probeFusionPluginHealth,
  validatePluginEndpoint,
} from "./platform";
import { runLocalCadUpdate } from "./update";
import { doctorExitCode, formatDoctorReport, runDoctor } from "./doctor";
import { runClaudeCadCli } from "./claude";
import { runCadMcpStdio } from "@vantage/cad";
// Imported by path rather than through the package barrel: these modules are owned by
// the browser-session workstream and the barrel is edited concurrently by others.
import {
  formatClaudeCadSession,
  loadClaudeCadSession,
  noteSessionCalls,
  saveClaudeCadSession,
  type ClaudeCadSession,
} from "../../cad/src/claude-session";
import { describeCallTally, formatCallBudget } from "../../cad/src/call-budget";
import {
  clearOnshapeBrowserSession,
  loadOnshapeBrowserSession,
  onshapeSessionStatus,
} from "../../cad/src/onshape-session-store";
import { probeOnshapeIdentity, resolveOnshapeAuth } from "../../cad/src/onshape-session";
import { createChromiumLoginLauncher, formatLoginResult, runOnshapeBrowserLogin } from "./login";
import { createCadSyncReporter, formatCadStatusLines, readCadSyncStatus } from "./sync";

const VERSION = "0.1.1";
const command = process.argv[2] ?? "help";
const base = (process.env.VANTAGE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const ask = command === "setup" ? createInterface({ input, output }) : null;

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`));
  return data;
}

async function heartbeat(credential: Record<string, string>) {
  return json("/api/cad/relay/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${credential.deviceToken}` } as Record<string, string>,
    body: JSON.stringify({ cliVersion: VERSION }),
  });
}

function windowsInstallHint() {
  if (osPlatform() !== "win32") return;
  console.log(
    "\nWindows install (from repo):\n  powershell -ExecutionPolicy Bypass -File .\\scripts\\cad\\install-windows.ps1",
  );
}

async function setup() {
  console.log("\nVantage CAD desktop setup\nNo Vantage password is entered in this terminal.");
  const started = await json("/api/cad/pair/start", {
    method: "POST",
    body: JSON.stringify({ machineName: hostname(), cliVersion: VERSION }),
  });
  // Never print pollToken — it is the device-side secret for this pairing session.
  console.log(
    `\nPairing code: ${started.userCode}\nOpen: ${started.verificationUri}\nChoose your authorized organization and CAD platform in the browser.\nCode expires in ${started.expiresIn}s.`,
  );
  await openBrowser(String(started.verificationUri)).catch(() =>
    console.log("Browser could not open automatically; copy the URL above."),
  );

  let paired: Record<string, unknown> | null = null;
  const deadline = Date.now() + Number(started.expiresIn) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Number(started.interval) * 1000));
    const response = await fetch(`${base}/api/cad/pair/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pollToken: started.pollToken }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (data.status === "pending") continue;
    if (data.status === "approved") {
      paired = data;
      break;
    }
    throw new Error(`Pairing ${String(data.status ?? "failed")}`);
  }
  if (!paired) throw new Error("Pairing expired. Run setup again.");

  const status = await heartbeat({ deviceToken: String(paired.deviceToken) });
  const device = status.device as Record<string, unknown>;
  const platform = String(device.platform);
  console.log(
    `\nPaired ${String(device.machineName)} to organization ${String(device.orgId)} for ${platform}.`,
  );

  if (platform === "onshape") {
    console.log(
      "\nOnshape hosted path:\n1. Continue in Vantage CAD Connections and authorize Onshape OAuth.\n2. Select document, workspace, and element permissions in the browser.\n3. Run `vantage-cad doctor` to test. The Vantage server executes hosted jobs; this CLI need not stay running.",
    );
  } else {
    const fusion = await detectFusionPrerequisites();
    console.log(
      "\nFusion 360 local path:\n1. Install Autodesk Fusion 360 and sign in to your Autodesk account.\n2. Install the Vantage add-in (Windows: scripts\\cad\\install-fusion-addin.ps1 or install-windows.ps1).\n3. In Fusion: Utilities → Add-Ins → Scripts and Add-Ins → run VantageCadRelay.\n4. Keep Fusion open, then run `vantage-cad start`.",
    );
    windowsInstallHint();
    console.log(
      `Expected add-in folder${fusion.paths.length === 1 ? "" : "s"}:\n${
        fusion.paths.map((path) => `  ${path}`).join("\n") ||
        "  Fusion relay is supported only on Windows and macOS."
      }`,
    );
    if (fusion.installed.length) {
      for (const addin of fusion.installed) {
        console.log(`Installed VantageCadRelay${addin.version ? ` v${addin.version}` : ""} at ${addin.path}`);
      }
    } else if (!fusion.existing.length) {
      console.log(
        "The Fusion add-in directory was not detected. Installation requires your action; Vantage will not modify Fusion automatically.",
      );
    } else {
      console.log("Fusion AddIns folder exists, but VantageCadRelay is not installed yet.");
    }
    const endpoint = await ask!.question(`Fusion plugin endpoint [${DEFAULT_FUSION_PLUGIN_ENDPOINT}]: `);
    paired.pluginEndpoint = validatePluginEndpoint(endpoint || DEFAULT_FUSION_PLUGIN_ENDPOINT).toString();
  }

  console.log(
    "\nAI execution source:\n1. Vantage managed plan (recommended reliable default)\n2. Team/platform configured OpenAI or Anthropic API\n3. Personal BYOK API key (configure in the encrypted Vantage browser form)\n4. Local OpenAI-compatible URL\n5. Claude Code local connector — platform owner private local sessions only; never team/background traffic",
  );
  const provider = await ask!.question("Choose 1–5: ");
  if (!["1", "2", "3", "4", "5"].includes(provider)) throw new Error("Unsupported provider selection");
  if (provider === "3") {
    console.log(
      "Open Vantage provider settings to add an official API key. ChatGPT/Claude consumer subscriptions are not API credentials.",
    );
  }
  if (provider === "4") {
    const url = await ask!.question("Local OpenAI-compatible HTTPS URL: ");
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Local provider URL must use HTTP(S)");
    paired.localBaseUrl = parsed.toString();
  }
  if (provider === "5") {
    console.log(
      "Personal local use only. Requires platform_admin, this matching paired device, private interactive scope, and explicit opt-in. It cannot serve members, shared queues, memory generation, scheduled jobs, or production web traffic.",
    );
  }

  const storage = await saveDeviceCredential({
    deviceToken: String(paired.deviceToken),
    deviceId: String(paired.deviceId),
    orgId: String(paired.orgId),
    userId: String(paired.userId),
    platform,
    provider,
    baseUrl: base,
    ...(paired.localBaseUrl ? { localBaseUrl: String(paired.localBaseUrl) } : {}),
    ...(paired.pluginEndpoint ? { pluginEndpoint: String(paired.pluginEndpoint) } : {}),
  });
  console.log(`\nSetup complete. Device token stored in ${storage}.`);
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Onshape auth + call-ledger lines shared by `status` and `login --status`. */
async function onshapeAuthLines(): Promise<string[]> {
  const saved = await loadOnshapeBrowserSession();
  const sessionState = onshapeSessionStatus(saved);
  const lines = [
    `${sessionState.connected ? "[PASS]" : "[WARN]"} Onshape session: ${sessionState.message}`,
  ];
  if (sessionState.accountLabel) lines.push(`       account ${sessionState.accountLabel}`);
  const cad: ClaudeCadSession = await loadClaudeCadSession().catch(() => ({}));
  lines.push(`       ${describeCallTally(cad.calls)}`);
  return lines;
}

async function login() {
  if (process.argv.includes("--clear")) {
    const removed = await clearOnshapeBrowserSession();
    console.log(
      removed
        ? "Saved Onshape browser session removed. Run `vantage-cad login` to sign in again."
        : "No saved Onshape browser session to remove.",
    );
    return;
  }
  if (process.argv.includes("--status")) {
    for (const line of await onshapeAuthLines()) console.log(line);
    return;
  }

  const timeoutSeconds = Number(flagValue("--timeout") ?? "300");
  const result = await runOnshapeBrowserLogin({
    launch: createChromiumLoginLauncher(),
    ...(process.env.ONSHAPE_BASE_URL ? { baseUrl: process.env.ONSHAPE_BASE_URL } : {}),
    ...(Number.isFinite(timeoutSeconds) ? { timeoutMs: Math.max(30, timeoutSeconds) * 1_000 } : {}),
  });
  for (const line of formatLoginResult(result)) console.log(line);
  if (result.status !== "signed-in") {
    process.exitCode = 1;
    return;
  }

  // Onshape does not document session-cookie replay by a third-party process, so the
  // premise is measured here rather than assumed: one call on the saved cookies,
  // outside the browser, against the documented /users/current endpoint.
  try {
    const auth = await resolveOnshapeAuth({ prefer: "session" });
    const identity = await probeOnshapeIdentity(auth.http);
    if (identity) {
      console.log(`Verified: the saved session authenticates outside the browser as ${identity.name ?? identity.id}.`);
    } else {
      process.exitCode = 1;
      console.log(
        "Warning: Onshape accepted the sign-in but the saved cookies did not authenticate when replayed from this process. Use OAuth or API keys for now (API-key calls are deducted from your annual allowance).",
      );
    }
    const summary = auth.budget.summary();
    for (const line of formatCallBudget(summary)) console.log(line);
    const cad: ClaudeCadSession = await loadClaudeCadSession().catch(() => ({}));
    await saveClaudeCadSession(noteSessionCalls(cad, summary));
  } catch (error) {
    process.exitCode = 1;
    console.log(`Warning: could not verify the saved session — ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function status() {
  const asJson = process.argv.includes("--json");
  const credential = await loadDeviceCredential();
  const bound: ClaudeCadSession = await loadClaudeCadSession().catch(() => ({}));
  const sync = await readCadSyncStatus();
  const onshapeSession = onshapeSessionStatus(await loadOnshapeBrowserSession());

  let device: Record<string, unknown> | null = null;
  let serverReachable = false;
  let serverDetail = "";
  if (credential) {
    try {
      const result = await heartbeat(credential);
      device = result.device as Record<string, unknown>;
      serverReachable = true;
    } catch (error) {
      serverDetail = error instanceof Error ? error.message : "connection failed";
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          connected: serverReachable,
          paired: Boolean(credential),
          device,
          platform: device?.platform ?? credential?.platform ?? null,
          bound: bound && (bound as { documentId?: string }).documentId ? bound : null,
          onshapeSession,
          onshapeCalls: bound.calls ?? null,
          sync,
          credentialStorage: credentialStorageStatus(),
          cliVersion: VERSION,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = formatCadStatusLines({
    cliVersion: VERSION,
    paired: Boolean(credential),
    platform: String(device?.platform ?? credential?.platform ?? "") || undefined,
    machineName: String(device?.machineName ?? "") || undefined,
    orgId: String(device?.orgId ?? credential?.orgId ?? "") || undefined,
    baseUrl: credential?.baseUrl ?? base,
    serverReachable,
    serverDetail,
    storage: credentialStorageStatus(),
    bound,
    sync,
  });
  console.log([...lines, ...(await onshapeAuthLines()), ...formatClaudeCadSession(bound)].join("\n"));
}

async function diagnose() {
  const asJson = process.argv.includes("--json");
  const report = await runDoctor({ version: VERSION, vantageUrl: base });
  console.log(formatDoctorReport(report, asJson));
  if (!asJson) {
    const fusion = await detectFusionPrerequisites();
    if (fusion.installed.length) {
      for (const addin of fusion.installed) {
        console.log(
          `Add-in detail: ${addin.path}${addin.version ? ` v${addin.version}` : ""}${
            addin.protocol ? ` · protocol ${addin.protocol}` : ""
          }`,
        );
      }
    } else if (fusion.supported) {
      windowsInstallHint();
    }
    console.log(
      "Consumer ChatGPT/Claude subscriptions are not tested as API credentials.",
    );
    console.log(
      "`vantage-cad login` stores YOUR Onshape browser session, captured in a window you sign into yourself, in a 0600 file under your home directory. No other site's cookies are read; `vantage-cad login --clear` deletes it.",
    );
    for (const line of await onshapeAuthLines()) console.log(line);
  }
  if (!report.ok) process.exitCode = doctorExitCode(report);
}

async function start() {
  const credential = await loadDeviceCredential();
  if (!credential) throw new Error("Not paired. Run `vantage-cad setup`.");
  if (credential.platform === "onshape") {
    console.log("Onshape jobs run on the Vantage server. This monitor may be closed at any time.");
    for (;;) {
      await heartbeat(credential);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  const useMock = process.env.VANTAGE_CAD_MOCK === "1";
  const plugin = validatePluginEndpoint(credential.pluginEndpoint ?? DEFAULT_FUSION_PLUGIN_ENDPOINT);
  if (useMock) {
    const { startMockFusionPluginServer } = await import("@vantage/cad");
    await startMockFusionPluginServer(Number(plugin.port || 32145));
    console.log("VANTAGE_CAD_MOCK=1 — started in-process mock Fusion plugin (no Autodesk required).");
  } else {
    const health = await probeFusionPluginHealth(plugin.toString());
    if (!health.reachable) {
      console.log(
        `Warning: Fusion plugin not reachable at ${plugin}. Run VantageCadRelay in Fusion (Windows: scripts\\cad\\install-fusion-addin.ps1), then keep it open.`,
      );
      windowsInstallHint();
    }
  }

  console.log(
    "Fusion local relay started. Keep Fusion running with the official connector add-in active (or mock plugin). Press Ctrl+C to stop.",
  );
  for (;;) {
    await heartbeat(credential);
    const claim = await fetch(`${base}/api/cad/relay/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential.deviceToken}` },
    });
    if (claim.status === 204) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    if (!claim.ok) throw new Error(`Job claim failed with HTTP ${claim.status}`);
    const envelope = (await claim.json()) as Record<string, unknown>;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const executed = await fetch(new URL("/execute", plugin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      const result = (await executed.json()) as Record<string, unknown>;
      await json("/api/cad/relay/jobs", {
        method: "PATCH",
        headers: { authorization: `Bearer ${credential.deviceToken}` } as Record<string, string>,
        body: JSON.stringify({
          jobId: envelope.jobId,
          stepId: envelope.stepId,
          leaseToken: envelope.leaseToken,
          state: executed.ok ? "completed" : "failed",
          progress: 100,
          result,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function logout() {
  const credential = await loadDeviceCredential();
  if (credential) {
    await json("/api/cad/relay/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${credential.deviceToken}` } as Record<string, string>,
      body: "{}",
    }).catch(() => undefined);
  }
  await clearDeviceCredential();
  console.log("Local credential removed and paired device revoked.");
}

async function update() {
  const forceAddin = process.argv.includes("--force-addin");
  const skipAddin = process.argv.includes("--skip-addin");
  console.log(`Updating local CAD relay from repository checkout (CLI ${VERSION})…`);
  const result = await runLocalCadUpdate({ forceAddin, skipAddin });
  for (const note of result.notes) console.log(`  ${note}`);
  console.log(
    `\nUpdate finished. CLI reinstalled=${result.cliUpdated} add-in reinstalled=${result.addinUpdated}.\nRun: vantage-cad doctor`,
  );
}

async function main() {
  if (command === "setup") await setup();
  else if (command === "login") await login();
  else if (command === "status") await status();
  else if (command === "diagnose" || command === "doctor") await diagnose();
  else if (command === "start") await start();
  else if (command === "logout") await logout();
  else if (command === "update") await update();
  else if (command === "mcp") {
    // Sync is a bonus, never a blocker: the reporter says once (on stderr — stdout
    // is MCP protocol) if it cannot reach the app and keeps working locally.
    const reporter = createCadSyncReporter();
    void reporter.sessionStart();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      void reporter.sessionEnd("completed").finally(() => process.exit(process.exitCode ?? 0));
    };
    process.stdin.on("end", end);
    process.on("SIGINT", end);
    process.on("SIGTERM", end);
    await runCadMcpStdio({
      onToolCall: (name, args, ok, error) => reporter.toolCall(name, args, ok, error),
    });
  } else if (command === "agent") {
    const { runAgentSync } = await import("./agent-sync");
    await runAgentSync(process.argv.slice(3));
  } else if (command === "claude" || command === "onshape" || command === "fusion") {
    const reporter = createCadSyncReporter();
    await runClaudeCadCli(command, process.argv[3] ?? "", (tool, args, ok, error) =>
      reporter.oneShotToolCall(tool, args, ok, error),
    );
  } else {
    console.log("vantage-cad <login|setup|start|status|diagnose|doctor|update|logout|claude|mcp|agent|onshape|fusion>");
    console.log("  login [--timeout <s>] [--status] [--clear]");
    console.log("                         sign into Onshape in a browser window and save the session.");
    console.log("                         Session calls are not deducted from your Onshape annual API allowance;");
    console.log("                         API keys are. This is the `cadcursor login` step.");
    console.log("  agent sync [--dir <repo>] [--dry-run]  pull team agent config (rules, subagents, MCP, skills)");
    console.log("  status [--json]        platform, binding, Onshape auth path, call ledger, and web sync state");
    console.log("  claude                 print Claude Code CAD setup + status");
    console.log("  mcp                    stdio MCP server for Claude Code");
    console.log("  onshape docs|bind|sketch|extrude");
    console.log("  fusion ping|sketch|extrude");
    console.log("  doctor|diagnose [--json]   run local CAD health checks");
    console.log("  update [--force-addin] [--skip-addin]  reinstall from VANTAGE_REPO / monorepo checkout");
  }
}

main()
  .catch((error) => {
    console.error(`vantage-cad: ${error instanceof Error ? error.message : "Command failed"}`);
    process.exitCode = 1;
  })
  .finally(() => {
    ask?.close();
  });
