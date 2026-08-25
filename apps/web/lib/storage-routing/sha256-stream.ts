/**
 * Incremental SHA-256 for the browser upload pipeline.
 *
 * WebCrypto's crypto.subtle.digest needs the WHOLE buffer in memory, which is
 * exactly what a 2 GB video upload must avoid. This is a small, dependency-free
 * streaming implementation: feed chunks as they are read from the File, get
 * the hex digest at the end. Verified against node:crypto in
 * sha256-stream.test.ts across chunk-boundary edge cases.
 *
 * Pure and environment-free (no DOM, no node imports) so it runs in the
 * browser and in vitest identically.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256Stream {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private blockUsed = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);
  private finished = false;

  update(chunk: Uint8Array): this {
    if (this.finished) throw new Error("Sha256Stream: update() after digest()");
    this.totalBytes += chunk.length;
    let offset = 0;
    if (this.blockUsed > 0) {
      const need = 64 - this.blockUsed;
      const take = Math.min(need, chunk.length);
      this.block.set(chunk.subarray(0, take), this.blockUsed);
      this.blockUsed += take;
      offset = take;
      if (this.blockUsed === 64) {
        this.compress(this.block, 0);
        this.blockUsed = 0;
      }
    }
    while (offset + 64 <= chunk.length) {
      this.compress(chunk, offset);
      offset += 64;
    }
    if (offset < chunk.length) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockUsed = chunk.length - offset;
    }
    return this;
  }

  digestHex(): string {
    if (this.finished) throw new Error("Sha256Stream: digest() called twice");
    this.finished = true;
    const bitLength = this.totalBytes * 8;
    const padded = new Uint8Array(this.blockUsed + 9 <= 64 ? 64 : 128);
    padded.set(this.block.subarray(0, this.blockUsed), 0);
    padded[this.blockUsed] = 0x80;
    const view = new DataView(padded.buffer);
    // 64-bit big-endian bit length; JS numbers hold byte counts to 2^53 safely.
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    this.compress(padded, 0);
    if (padded.length === 128) this.compress(padded, 64);
    let hex = "";
    for (let i = 0; i < 8; i += 1) {
      hex += this.state[i]!.toString(16).padStart(8, "0");
    }
    return hex;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) >>> 0;
      const s1 = (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    // Annotated explicitly: destructuring the typed array leaves these `number |
    // undefined`, which makes temp1/temp2/S0 below circularly inferred (TS7022).
    let a: number = this.state[0]!;
    let b: number = this.state[1]!;
    let c: number = this.state[2]!;
    let d: number = this.state[3]!;
    let e: number = this.state[4]!;
    let f: number = this.state[5]!;
    let g: number = this.state[6]!;
    let h: number = this.state[7]!;
    for (let i = 0; i < 64; i += 1) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

/** How much of a Blob to read per hashing step (memory ceiling, not a chunk-protocol size). */
export const HASH_READ_BYTES = 8 * 1024 * 1024;

/**
 * Hash a Blob/File without ever holding more than HASH_READ_BYTES in memory.
 * `onProgress` receives bytes hashed so far.
 */
export async function sha256HexOfBlob(
  blob: Blob,
  onProgress?: (hashedBytes: number) => void,
): Promise<string> {
  const hasher = new Sha256Stream();
  let offset = 0;
  while (offset < blob.size) {
    const slice = blob.slice(offset, Math.min(offset + HASH_READ_BYTES, blob.size));
    const buffer = new Uint8Array(await slice.arrayBuffer());
    hasher.update(buffer);
    offset += buffer.length;
    onProgress?.(offset);
  }
  return hasher.digestHex();
}
