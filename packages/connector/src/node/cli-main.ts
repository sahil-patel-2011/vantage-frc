import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { AgentSyncCapability } from "../agent-sync.js";
import { AiBridgeCapability } from "../ai-bridge.js";
import { CadRelayCapability } from "../cad-relay.js";
import { buildStatusSnapshot, parseCliArgs, runCli, type CliHost } from "../cli.js";
import { LocalModelsCapability } from "../local-models.js";
import { McpCapability, connectorStatusToolRegistry } from "../mcp.js";
import { StorageNodeCapability } from "../storage-node.js";
import {
  fetchTransport,
  nodeClock,
  nodeFileSystem,
  nodeHome,
  nodeMachineName,
  nodeSpawner,
} from "./adapters.js";

/**
 * Node wiring for the headless connector CLI: real ports, real signals, real stdio.
 * Nothing here runs at module scope except the `executedDirectly()` guard at the bottom,
 * so importing this file resolves no secrets and opens no connections.
 *
 * stdout discipline: the `mcp` command speaks JSON-RPC on stdout, so every human-readable
 * line the CLI emits during that command must go to stderr. runCli only ever writes MCP
 * frames through the injected stdio pair, so `out` stays safe — but the shutdown wiring
 * below still watches stdin so an editor closing the pipe ends the process instead of
 * leaving an orphan.
 */

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 is "a platform independent way to test for the existence of a process …
    // will throw an error if the process does not exist"
    // https://nodejs.org/api/process.html#processkillpid-signal
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // kill(2) splits the two failures: ESRCH = no such process, EPERM = the process
    // exists but this user may not signal it (so it IS alive).
    // https://man7.org/linux/man-pages/man2/kill.2.html
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Platform truth, not a promise: on Linux/macOS both signals reach the handler, so systemd
 * `stop` and Ctrl+C both shut capabilities down cleanly. On Windows "SIGTERM is not
 * supported … it can be listened on" and a programmatic kill causes "unconditional
 * termination of the target process" — only a console Ctrl+C (SIGINT) runs this path
 * there, and a killed Windows process leaves the runtime state file without `stoppedAt`,
 * which is exactly what `--status` then reports.
 * https://nodejs.org/api/process.html#processkillpid-signal
 */
function registerShutdown(watchStdin: boolean): (handler: (reason: string) => void) => () => void {
  return (handler) => {
    let fired = false;
    const fire = (reason: string, hardExitCode: number) => {
      if (fired) {
        // A second Ctrl+C means the operator is insisting: leave now. 128 + signal number
        // is the shell's convention for "terminated by this signal".
        process.exit(hardExitCode);
      }
      fired = true;
      handler(reason);
    };
    const onInt = () => fire("Received SIGINT", 130);
    const onTerm = () => fire("Received SIGTERM", 143);
    const onStdinEnd = () => fire("stdin closed", 0);
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    if (watchStdin) process.stdin.on("end", onStdinEnd);
    return () => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      if (watchStdin) process.stdin.off("end", onStdinEnd);
    };
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const isMcp = parseCliArgs(argv).kind === "mcp";
  const host: CliHost = {
    argv,
    home: nodeHome(),
    machineName: nodeMachineName(),
    env: process.env,
    fs: nodeFileSystem,
    clock: nodeClock,
    transport: fetchTransport,
    spawner: nodeSpawner,
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    createCapabilities: () => [
      new AiBridgeCapability(),
      new CadRelayCapability(),
      new LocalModelsCapability(),
      new AgentSyncCapability(),
      new StorageNodeCapability(),
      // The one tool this host serves over stdio, so the capability reports the real
      // surface instead of an empty registry.
      new McpCapability({ registry: connectorStatusToolRegistry(() => buildStatusSnapshot(host)) }),
    ],
    onShutdown: registerShutdown(isMcp),
    pid: process.pid,
    isProcessAlive,
    stdio: { input: process.stdin, output: process.stdout },
  };
  return runCli(host);
}

/** True when this file is the process entry (`node dist/node/cli-main.js`, or via tsx). */
function executedDirectly(): boolean {
  try {
    const invoked = process.argv[1];
    if (!invoked) return false;
    const self = fileURLToPath(import.meta.url);
    const target = resolvePath(invoked);
    return self === target || self === `${target}.js` || self === `${target}.ts`;
  } catch {
    return false;
  }
}

if (executedDirectly()) {
  main()
    .then((code) => {
      // Set exitCode rather than calling exit(), so stdout/stderr flush first.
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
