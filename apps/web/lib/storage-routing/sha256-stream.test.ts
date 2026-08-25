import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HASH_READ_BYTES, Sha256Stream, sha256HexOfBlob } from "./sha256-stream";

/**
 * This hasher exists because SubtleCrypto cannot hash a multi-GB file incrementally,
 * and the storage node rejects an upload whose sha256 does not match. A wrong digest
 * here means every large upload fails (or, worse, a corrupted one is accepted), so
 * it is pinned against the published FIPS 180-4 vectors AND against Node's own
 * implementation over awkward chunk boundaries.
 */
const hex = (input: string) => createHash("sha256").update(input).digest("hex");

const encode = (value: string) => new TextEncoder().encode(value);

describe("Sha256Stream", () => {
  it("matches the published FIPS 180-4 vectors", () => {
    const empty = new Sha256Stream().digestHex();
    expect(empty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const abc = new Sha256Stream().update(encode("abc")).digestHex();
    expect(abc).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    const twoBlock = new Sha256Stream()
      .update(encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
      .digestHex();
    expect(twoBlock).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("is byte-identical to Node's crypto across the tricky lengths", () => {
    // 55/56/57 straddle the length-padding boundary, 63/64/65 the block boundary,
    // 119/128 the second block. These are where a hand-rolled implementation breaks.
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 127, 128, 129, 1000]) {
      const input = "x".repeat(length);
      expect(new Sha256Stream().update(encode(input)).digestHex(), `length ${length}`).toBe(
        hex(input),
      );
    }
  });

  it("produces the same digest no matter how the input is split across update() calls", () => {
    const input = "The quick brown fox jumps over the lazy dog".repeat(37);
    const expected = hex(input);
    const bytes = encode(input);

    for (const chunkSize of [1, 7, 63, 64, 65, 200]) {
      const hasher = new Sha256Stream();
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        hasher.update(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      }
      expect(hasher.digestHex(), `chunk ${chunkSize}`).toBe(expected);
    }
  });

  it("handles bytes outside the ASCII range", () => {
    const input = "héllo — 世界 🚀 STEP/DXF";
    expect(new Sha256Stream().update(encode(input)).digestHex()).toBe(hex(input));
  });

  it("refuses to keep hashing after digestHex()", () => {
    const hasher = new Sha256Stream();
    hasher.update(encode("abc"));
    hasher.digestHex();
    expect(() => hasher.update(encode("more"))).toThrow(/after digest/i);
  });
});

describe("sha256HexOfBlob", () => {
  it("hashes a Blob larger than one read window and reports real progress", async () => {
    // Two full read windows plus a remainder, so the slicing loop actually iterates.
    const size = HASH_READ_BYTES * 2 + 12_345;
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) payload[i] = i % 251;

    const expected = createHash("sha256").update(payload).digest("hex");
    const progress: number[] = [];
    const digest = await sha256HexOfBlob(new Blob([payload]), (bytes) => progress.push(bytes));

    expect(digest).toBe(expected);
    // Progress is monotonic and ends at the true size — the upload UI depends on both.
    expect(progress.at(-1)).toBe(size);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(progress.length).toBeGreaterThan(1);
  });

  it("hashes an empty Blob without reading anything", async () => {
    expect(await sha256HexOfBlob(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
