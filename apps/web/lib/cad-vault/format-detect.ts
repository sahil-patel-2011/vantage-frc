/**
 * Magic-byte CAD format detection. The extension is only consulted to pick a
 * member of an already-confirmed container family (zip, OLE compound, ISO
 * text); unknown magic is rejected with a specific message rather than trusted.
 * Pure over Uint8Array so it runs in node tests and in the browser.
 */

export const CAD_FORMATS = [
  "stl", "step", "stp", "iges", "igs", "3mf", "obj", "dxf", "pdf",
  "sldprt", "sldasm", "f3d", "ipt", "iam", "zip",
] as const;
export type CadFormat = (typeof CAD_FORMATS)[number];

export type FormatDetection =
  | { ok: true; format: CadFormat; mediaType: string }
  | { ok: false; reason: string };

export const CAD_MEDIA_TYPES: Record<CadFormat, string> = {
  stl: "model/stl",
  step: "model/step",
  stp: "model/step",
  iges: "model/iges",
  igs: "model/iges",
  "3mf": "model/3mf",
  obj: "model/obj",
  dxf: "image/vnd.dxf",
  pdf: "application/pdf",
  sldprt: "application/octet-stream",
  sldasm: "application/octet-stream",
  f3d: "application/octet-stream",
  ipt: "application/octet-stream",
  iam: "application/octet-stream",
  zip: "application/zip",
};

export function fileExtension(filename: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : "";
}

function accepted(format: CadFormat): FormatDetection {
  return { ok: true, format, mediaType: CAD_MEDIA_TYPES[format] };
}

function startsWithBytes(data: Uint8Array, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (data[i] !== magic[i]) return false;
  return true;
}

function asciiHead(data: Uint8Array, length: number): string {
  const slice = data.subarray(0, Math.min(length, data.length));
  let out = "";
  for (let i = 0; i < slice.length; i++) out += String.fromCharCode(slice[i]!);
  return out;
}

/** Binary STL: 80-byte header + uint32 triangle count that matches the byte length. */
export function isBinaryStl(data: Uint8Array): boolean {
  if (data.length < 84) return false;
  if ((data.length - 84) % 50 !== 0) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declared = view.getUint32(80, true);
  return declared === (data.length - 84) / 50;
}

/** ASCII STL: leads with "solid" and actually contains facet data. */
export function isAsciiStl(data: Uint8Array): boolean {
  const head = asciiHead(data, 4096);
  return /^\s*solid\b/.test(head) && head.includes("facet normal");
}

function isIges(data: Uint8Array): boolean {
  // IGES is fixed 80-column ASCII; column 73 of the first record is the
  // section letter 'S' (start section).
  const head = asciiHead(data, 90);
  if (head.length < 73) return false;
  if (!/^[\x20-\x7e]+$/.test(head.slice(0, 72))) return false;
  return head[72] === "S";
}

function isDxf(data: Uint8Array): boolean {
  const head = asciiHead(data, 64);
  if (head.startsWith("AutoCAD Binary DXF")) return true;
  const lines = head.split(/\r?\n/).map((line) => line.trim());
  return lines[0] === "0" && lines[1] === "SECTION";
}

function isObjText(data: Uint8Array): boolean {
  const head = asciiHead(data, 4096);
  // Printable ASCII plus tab/newline/carriage-return only.
  if (!/^[\t\n\r\x20-\x7e]*$/.test(head)) return false;
  return /^(?:\s|#[^\n]*\n)*(?:mtllib|usemtl|[og]\s|v[nt]?\s)/.test(head) && /^v\s+-?[\d.]/m.test(head);
}

/**
 * Detect the real format from the leading bytes. `filename` only picks a member
 * inside a confirmed container family — it can never rescue unknown magic.
 */
export function detectCadFormat(data: Uint8Array, filename: string): FormatDetection {
  if (data.length === 0) return { ok: false, reason: "The file is empty." };
  const ext = fileExtension(filename);

  if (isBinaryStl(data) || isAsciiStl(data)) return accepted("stl");

  const head = asciiHead(data, 256);
  if (head.trimStart().startsWith("ISO-10303-21")) return accepted(ext === "stp" ? "stp" : "step");

  if (startsWithBytes(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return accepted("pdf"); // %PDF-

  if (startsWithBytes(data, [0x50, 0x4b, 0x03, 0x04])) {
    // zip family: 3MF and Fusion archives are zips; extension picks the member.
    if (ext === "3mf") return accepted("3mf");
    if (ext === "f3d") return accepted("f3d");
    return accepted("zip");
  }

  if (startsWithBytes(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // OLE compound file: SolidWorks / Inventor native formats.
    if (ext === "sldprt") return accepted("sldprt");
    if (ext === "sldasm") return accepted("sldasm");
    if (ext === "ipt") return accepted("ipt");
    if (ext === "iam") return accepted("iam");
    return {
      ok: false,
      reason:
        "This is a Microsoft compound file, but the extension is not a recognized CAD format (.sldprt, .sldasm, .ipt, .iam).",
    };
  }

  if (isIges(data)) return accepted(ext === "igs" ? "igs" : "iges");
  if (isDxf(data)) return accepted("dxf");
  if (ext === "obj" && isObjText(data)) return accepted("obj");

  if (data.length >= 84 && (data.length - 84) % 50 === 0 && ext === "stl") {
    return {
      ok: false,
      reason:
        "This looks like a binary STL, but its declared triangle count does not match the file size — the file is truncated or corrupt.",
    };
  }

  return {
    ok: false,
    reason: `Unrecognized file contents${ext ? ` for .${ext}` : ""}. The vault accepts STL, STEP, IGES, 3MF, OBJ, DXF, PDF, SolidWorks, Inventor, Fusion archives, and ZIP — and verifies the bytes, not the extension.`,
  };
}
