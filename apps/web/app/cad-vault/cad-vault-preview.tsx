"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { parseStl } from "../../lib/cad-vault/stl-geometry";
import { rasterizeStl } from "../../lib/cad-vault/stl-render";
import { cadVaultGeometryCopy } from "../../lib/cad-vault/cad-vault-related";
import type { CadVersionSummary } from "../../lib/cad-vault/view";

const MAX_INLINE_PREVIEW_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function readTriangleCount(geometry: Record<string, unknown> | null): number | null {
  if (!geometry) return null;
  return typeof geometry.triangleCount === "number" ? geometry.triangleCount : null;
}

/** Draw an already-parsed STL triangle soup on a canvas (same raster as the server). */
export function StlCanvas({ data, label }: { data: Uint8Array; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const triangles = parseStl(data);
      const raster = rasterizeStl(triangles, { size: 320 });
      canvas.width = raster.width;
      canvas.height = raster.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
      setFailure("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not render this STL.");
    }
  }, [data]);

  if (failure) return <p className="app-muted">Preview unavailable: {failure}</p>;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: "var(--radius-sm, 12px)", border: "1px solid var(--line)" }}
    />
  );
}

/** On-demand preview of a stored version: canvas render <=20 MB, stored thumbnail above. */
export function StoredVersionPreview({ version }: { version: CadVersionSummary }) {
  const [state, setState] = useState<"idle" | "loading" | "shown" | "failed">("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  if (version.format !== "stl") return null;

  if (version.byteSize > MAX_INLINE_PREVIEW_BYTES) {
    return version.hasThumbnail ? (
      <figure style={{ margin: 0 }}>
        <img
          src={`/api/cad-vault/file/${version.publicId}/thumbnail`}
          alt={`Server-rendered thumbnail of ${version.filename}`}
          width={220}
          height={220}
          style={{ maxWidth: "100%", height: "auto", borderRadius: "var(--radius-sm, 12px)", border: "1px solid var(--line)" }}
        />
        <figcaption className="app-muted">
          <small>{formatBytes(version.byteSize)} — too large for the live preview; showing the stored thumbnail.</small>
        </figcaption>
      </figure>
    ) : (
      <p className="app-muted">
        <small>{formatBytes(version.byteSize)} is above the 20 MB live-preview limit and no thumbnail was rendered.</small>
      </p>
    );
  }

  if (state === "idle" || state === "loading") {
    return (
      <Button
        variant="secondary"
        type="button"
        disabled={state === "loading"}
        onClick={() => {
          setState("loading");
          void fetch(`/api/cad-vault/file/${version.publicId}`)
            .then(async (response) => {
              if (!response.ok) throw new Error("download failed");
              const buffer = await response.arrayBuffer();
              setBytes(new Uint8Array(buffer));
              setState("shown");
            })
            .catch(() => setState("failed"));
        }}
      >
        {state === "loading" ? "Loading model…" : "Preview 3D"}
      </Button>
    );
  }
  if (state === "failed") return <p className="app-muted">Could not load the model for preview.</p>;
  return bytes ? <StlCanvas data={bytes} label={`Isometric preview of ${version.filename}`} /> : null;
}

export function GeometrySummary({ version }: { version: CadVersionSummary }) {
  const triangleCount = readTriangleCount(version.geometry);
  return (
    <p className="app-muted" style={{ margin: 0 }}>
      <small>{cadVaultGeometryCopy({ triangleCount, format: version.format })}</small>
    </p>
  );
}

export { formatBytes, MAX_INLINE_PREVIEW_BYTES };
