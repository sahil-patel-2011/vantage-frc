import { EmptyState } from "../../components/ui";

export type CadViewportProps = {
  pngBase64?: string | null;
  openUrl?: string | null;
  setupRequired?: boolean;
};

function safeOpenUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Only a PNG data URL (or raw PNG base64) may become an <img src>.
 * http(s) Onshape document URLs are rejected so this pane can never
 * point an embed or image at cad.onshape.com.
 */
function pngImgSrc(pngBase64: string | null | undefined): string | null {
  if (typeof pngBase64 !== "string") return null;
  const value = pngBase64.trim();
  if (!value) return null;
  if (/^https?:/i.test(value) || /^\/\//.test(value) || /onshape\.com/i.test(value)) return null;
  if (value.startsWith("data:image/png;base64,")) return value;
  if (value.startsWith("data:")) return null;
  if (value.length < 32 || /[^A-Za-z0-9+/=\s]/.test(value)) return null;
  return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
}

function OpenInOnshapeLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      Open in Onshape
    </a>
  );
}

/**
 * In-app CAD viewport: a real Onshape shaded-view PNG, or an honest empty
 * state. Never an Onshape iframe. "Open in Onshape" is a text link only.
 */
export function CadViewport({ pngBase64, openUrl, setupRequired = false }: CadViewportProps) {
  const src = pngImgSrc(pngBase64);
  const href = safeOpenUrl(openUrl);
  const openLink = href ? <OpenInOnshapeLink href={href} /> : null;

  return (
    <section className="cad-agent-viewport" aria-label="CAD viewport">
      <div className="cad-agent-col-head">
        Viewport
        {openLink ?? <span>Onshape</span>}
      </div>
      {src ? (
        <div className="cad-agent-empty-view">
          <img alt="Onshape shaded view" src={src} />
        </div>
      ) : (
        <EmptyState
          className="cad-agent-empty-view"
          title={setupRequired ? "Onshape setup required" : "No shaded view yet"}
          description={
            setupRequired
              ? "Connect Onshape before a shaded view can load. The viewport stays empty."
              : "No Onshape shaded-view PNG is available. The viewport stays empty until a real render arrives."
          }
          badge={setupRequired ? "Setup" : undefined}
          badgeTone={setupRequired ? "setup" : undefined}
          soft
        >
          {openLink}
        </EmptyState>
      )}
    </section>
  );
}
