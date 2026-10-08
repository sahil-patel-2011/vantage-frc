import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertNativeTarget, assertRelocatableTree, nativeArchitectures } from "./packaging-resources.mjs";

test("identifies thin and universal Mac binaries without launching them", () => {
  const thin = Buffer.alloc(32);
  thin.writeUInt32LE(0xfeedfacf, 0); thin.writeUInt32LE(0x0100000c, 4);
  assert.deepEqual(nativeArchitectures(thin, "darwin"), ["arm64"]);
  const fat = Buffer.alloc(48);
  fat.writeUInt32BE(0xcafebabe, 0); fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8); fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(nativeArchitectures(fat, "darwin"), ["x64", "arm64"]);
  assert.deepEqual(nativeArchitectures(fat.subarray(0, 47), "darwin"), []);
  assert.deepEqual(nativeArchitectures(Buffer.from("shell script"), "darwin"), []);
});

test("validates Windows native headers and rejects a mismatched architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "vantage-package-header-"));
  try {
    const pe = Buffer.alloc(134);
    pe.write("MZ"); pe.writeUInt32LE(128, 0x3c);
    pe.writeUInt32LE(0x00004550, 128); pe.writeUInt16LE(0x8664, 132);
    const file = join(root, "fixture.node"); await writeFile(file, pe);
    await assertNativeTarget(file, "win32", "x64");
    await assert.rejects(assertNativeTarget(file, "win32", "arm64"), /Expected a win32-arm64/);
    await assert.rejects(assertNativeTarget(file, "darwin", "x64"), /Expected a darwin-x64/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("permits relative framework links but rejects release-host or external links", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "vantage-package-links-"));
  try {
    const bundle = join(root, "bundle"); await mkdir(bundle);
    await writeFile(join(bundle, "binary"), "fixture");
    await symlink("binary", join(bundle, "relative"));
    await assertRelocatableTree(bundle);
    await symlink(join(bundle, "binary"), join(bundle, "absolute"));
    await assert.rejects(assertRelocatableTree(bundle), /relative path/);
    await rm(join(bundle, "absolute"));
    await writeFile(join(root, "outside"), "fixture");
    await symlink("../outside", join(bundle, "escape"));
    await assert.rejects(assertRelocatableTree(bundle), /inside its bundle/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
