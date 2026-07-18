"use client";

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

function getBarcodeDetector():
  | (new (options?: { formats: string[] }) => BarcodeDetectorLike)
  | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike })
      .BarcodeDetector ?? null
  );
}

export function cameraScanSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function renderQrDataUrl(payload: string, size = 280): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: size,
    color: { dark: "#172126", light: "#ffffff" },
  });
}

async function detectWithBarcodeApi(video: HTMLVideoElement): Promise<string | null> {
  const Detector = getBarcodeDetector();
  if (!Detector) return null;
  try {
    const detector = new Detector({ formats: ["qr_code"] });
    const codes = await detector.detect(video);
    return codes[0]?.rawValue?.trim() || null;
  } catch {
    return null;
  }
}

async function detectWithJsQr(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string | null> {
  const jsQR = (await import("jsqr")).default;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const code = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
  return code?.data?.trim() || null;
}

export async function scanQrFromCamera(options: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<string> {
  const intervalMs = options.intervalMs ?? 220;
  while (!options.signal.aborted) {
    const native = await detectWithBarcodeApi(options.video);
    if (native) return native;
    const fallback = await detectWithJsQr(options.video, options.canvas);
    if (fallback) return fallback;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new DOMException("QR scan aborted", "AbortError");
}

export async function openRearCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}
