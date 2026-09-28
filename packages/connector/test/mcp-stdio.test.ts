import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { dispatchConnectorMcp, emptyToolRegistry, encodeMcpStdio, McpFrameDecoder } from "../src/mcp.js";

describe("personal MCP stdio", () => {
  it("negotiates supported versions and writes one JSON value per line", async () => {
    const messages: unknown[] = [];
    await dispatchConnectorMcp({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, emptyToolRegistry(), (value) => messages.push(value));
    expect(messages[0]).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    const wire = encodeMcpStdio({ jsonrpc: "2.0", id: 2, result: { text: "Unicode ✓\nmultiline" } });
    expect(wire.toString().split("\n")).toHaveLength(2);
    const decoder = new McpFrameDecoder();
    const split = wire.indexOf(Buffer.from("✓")) + 1;
    expect(decoder.push(wire.subarray(0, split))).toEqual([]);
    expect(decoder.push(wire.subarray(split))).toEqual([{ jsonrpc: "2.0", id: 2, result: { text: "Unicode ✓\nmultiline" } }]);
  });

  it("launches the downloadable bridge and calls only the selected person's API", async () => {
    const profile = "a0197b52-9e2b-4bd4-b6e8-2f42b857609a";
    const home = await mkdtemp(join(tmpdir(), "vantage-mcp-test-"));
    const requests: Array<{ authorization?: string; body: unknown }> = [];
    let revoked = false;
    const api = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
      response.writeHead(revoked ? 401 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(revoked ? { error: "This personal device was revoked." } : { result: { stock: [{ label: "Bearing", available: 6 }] } }));
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    const address = api.address() as { port: number };
    const directory = join(home, ".vantage", "profiles", profile);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "ai-bridge.json"), JSON.stringify({ userId: profile, orgId: "c0197b52-9e2b-4bd4-b6e8-2f42b857609a", deviceToken: "local-disposable-device-token", baseUrl: `http://127.0.0.1:${address.port}`, machineName: "Scratch MCP proof" }));
    const child = spawn(process.execPath, [resolve("apps/web/public/vantage-ai-bridge.mjs"), "--profile", profile, "--mcp"], { env: { ...process.env, HOME: home, USERPROFILE: home, VANTAGE_PROFILE: profile }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    let buffer = "";
    const waiting = new Map<number, (message: Record<string, unknown>) => void>();
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line) as Record<string, unknown>;
        waiting.get(message.id as number)?.(message);
      }
    });
    const call = (id: number, method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolveReply, reject) => {
      const timeout = setTimeout(() => reject(new Error(`MCP response timed out: ${stderr}`)), 5000);
      waiting.set(id, (value) => { clearTimeout(timeout); waiting.delete(id); resolveReply(value); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    try {
      expect(await call(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "vantage-release-test", version: "1" } })).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
      const listed = await call(2, "tools/list");
      expect((listed.result as { tools: unknown[] }).tools).toHaveLength(9);
      const args = { query: "bearing", limit: 3 };
      const result = await call(3, "tools/call", { name: "vantage_inventory_availability", arguments: args });
      expect(result).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining("Bearing") }] } });
      expect(requests).toEqual([{ authorization: "Bearer local-disposable-device-token", body: { name: "vantage_inventory_availability", input: args } }]);
      revoked = true;
      expect(await call(4, "tools/call", { name: "vantage_inventory_availability", arguments: args })).toMatchObject({ result: { isError: true, content: [{ text: "This personal device was revoked." }] } });
      expect(await call(5, "tools/call", { name: "vantage_inventory_availability", arguments: { ...args, userId: "someone-else" } })).toMatchObject({ result: { isError: true } });
      expect(requests).toHaveLength(2);
    } finally {
      child.kill();
      api.closeAllConnections();
      await new Promise<void>((done) => api.close(() => done()));
      await rm(home, { recursive: true, force: true });
    }
  });
});
