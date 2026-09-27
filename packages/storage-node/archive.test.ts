import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createStorageItemServer } from "../connector/src/node/storage-server";
// @ts-expect-error -- standalone legacy service has no declarations
import { createItemServer } from "./server.mjs";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
describe("retired media storage", () => {
  for (const implementation of ["standalone", "connector"] as const) {
    it(`${implementation} rejects new writes and keeps authenticated archive access`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "vantage-archive-test-"));
      const bytes = Buffer.from("existing archived image bytes");
      const sha = sha256(bytes), key = randomUUID();
      const itemDir = path.join(dir, "items", sha.slice(0, 2), sha.slice(2, 4));
      await mkdir(itemDir, { recursive: true });
      await mkdir(path.join(dir, "uploads"));
      await writeFile(path.join(itemDir, sha), bytes);
      await writeFile(path.join(dir, "uploads", "legacy.part"), "unfinished legacy bytes");
      const state = { shas: new Set([sha]), usedBytes: bytes.length };
      const options = { dir, accessKeyHash: sha256(key), quotaBytes: 1000, state, name: "Archive fixture" };
      const server: Server = implementation === "standalone" ? createItemServer(options) : createStorageItemServer(options);
      try {
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing fixture port");
        const base = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${key}` };
        expect((await fetch(`${base}/items/${sha}`)).status).toBe(401);
        const stored = await fetch(`${base}/items/${sha}`, { headers });
        expect(stored.status).toBe(200);
        expect(stored.headers.get("cache-control")).toBe("private, no-store");
        expect(stored.headers.get("x-content-type-options")).toBe("nosniff");
        expect(Buffer.from(await stored.arrayBuffer())).toEqual(bytes);
        expect((await fetch(`${base}/health`)).status).toBe(200);
        expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ archiveOnly: true });
        expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(410);
        const ranged = await fetch(`${base}/items/${sha}`, { headers: { ...headers, range: "bytes=1-5" } });
        expect(ranged.status).toBe(206);
        expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(1, 6));
        for (const method of ["PUT", "POST", "PATCH"]) {
          const rejected = await fetch(`${base}/items/${sha256("new photo")}`, { method, headers, body: "new photo" });
          expect(rejected.status).toBe(410);
          await rejected.text();
        }
        if (implementation === "standalone") {
          for (const method of ["POST", "PATCH", "HEAD", "DELETE"]) {
            expect((await fetch(`${base}/uploads/${sha}`, { method, headers })).status).toBe(410);
          }
        }
        expect(await readdir(itemDir)).toEqual([sha]);
        expect(await readFile(path.join(dir, "uploads", "legacy.part"), "utf8")).toBe("unfinished legacy bytes");
        expect(state.usedBytes).toBe(bytes.length);
        expect((await fetch(`${base}/items/${sha}`, { method: "DELETE", headers })).status).toBe(200);
        expect(state.shas.size).toBe(0);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        // dir was created by mkdtemp specifically for this fixture.
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  it("rejects setup before contacting a provider or creating storage", async () => {
    await expect(promisify(execFile)(process.execPath, [path.resolve("packages/storage-node/server.mjs"), "--setup"], { timeout: 5000 }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("setup is no longer supported") });
  });
});
