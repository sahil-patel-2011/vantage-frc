/** Release-time file inspection only; never loads native code or launches a process. */
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function pathIsWithin(parent, child) {
  const value = relative(parent, child);
  return value === "" || !value.startsWith("..") && !isAbsolute(value);
}

/** Preserve relative framework links, but reject release-host paths and escapes. */
export async function assertRelocatableTree(source) {
  const root = await realpath(source);
  async function visit(path) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      if (isAbsolute(target) || !pathIsWithin(root, resolve(dirname(path), target)) ||
          !pathIsWithin(root, await realpath(path))) {
        throw new Error(`Resource symlink must resolve inside its bundle using a relative path: ${path}`);
      }
    } else if (entry.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    } else if (!entry.isFile()) throw new Error(`Unsupported resource file type: ${path}`);
  }
  await visit(root);
  return root;
}

/** Parse only executable headers; does not execute, import or inspect private data. */
export function nativeArchitectures(header, platform, peHeader) {
  if (header.length < 8) return [];
  const cpu = (value) => value === 0x01000007 ? "x64" : value === 0x0100000c ? "arm64" : undefined;
  if (platform === "darwin") {
    const little = header.readUInt32LE(0);
    if (little === 0xfeedfacf) return [cpu(header.readUInt32LE(4))].filter(Boolean);
    const magic = header.readUInt32BE(0);
    if (magic === 0xfeedfacf) return [cpu(header.readUInt32BE(4))].filter(Boolean);
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) return [];
    const count = header.readUInt32BE(4);
    const size = magic === 0xcafebabf ? 32 : 20;
    if (count > 32 || header.length < 8 + count * size) return [];
    return Array.from({ length: count }, (_, index) => cpu(header.readUInt32BE(8 + index * size))).filter(Boolean);
  }
  if (platform === "win32") {
    if (header[0] !== 0x4d || header[1] !== 0x5a || !peHeader || peHeader.length < 6 || peHeader.readUInt32LE(0) !== 0x00004550) return [];
    const machine = peHeader.readUInt16LE(4);
    return machine === 0x8664 ? ["x64"] : machine === 0xaa64 ? ["arm64"] : [];
  }
  return [];
}

export async function assertNativeTarget(file, platform, arch) {
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(1_032);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    let peHeader;
    if (platform === "win32" && bytesRead >= 64) {
      const offset = header.readUInt32LE(0x3c);
      const size = (await handle.stat()).size;
      if (offset < 64 || offset > size - 6) throw new Error(`Invalid Windows executable header: ${file}`);
      peHeader = Buffer.alloc(6);
      await handle.read(peHeader, 0, peHeader.length, offset);
    }
    if (!nativeArchitectures(header.subarray(0, bytesRead), platform, peHeader).includes(arch)) {
      throw new Error(`Expected a ${platform}-${arch} native binary: ${file}`);
    }
  } finally { await handle.close(); }
}
