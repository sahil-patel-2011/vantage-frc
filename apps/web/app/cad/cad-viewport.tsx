import { EmptyState, Button } from "../../components/ui";
import { OnshapeDocumentEmbed, OnshapeEditButton } from "./onshape-edit-board";
import { onshapeEditHref } from "../../lib/cad/onshape-edit-link";

export type CadViewportProps = {
  pngBase64?: string | null;
  openUrl?: string | null;
  setupRequired?: boolean;
};

/**
 * Only a PNG data URL (or raw PNG base64) may become an <img src>.
 * http(s) Onshape document URLs stay on the official embed iframe instead.
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

/**
 * In-app CAD viewport: official Onshape embed + Edit in Onshape, a real
 * picture when Onshape sent one, or an honest empty state.
 */
export function CadViewport({ pngBase64, openUrl, setupRequired = false }: CadViewportProps) {
  const src = pngImgSrc(pngBase64);
  const editHref = onshapeEditHref(openUrl);
  const editButton = editHref ? <OnshapeEditButton href={editHref} /> : null;

  return (
    <section className="cad-agent-viewport" aria-label="CAD viewport">
      <div className="cad-agent-col-head">
        Viewport
        {editButton ?? <span>Onshape</span>}
      </div>
      {editHref ? (
        <OnshapeDocumentEmbed url={editHref} />
      ) : src ? (
        <div className="cad-agent-empty-view">
          <img alt="Onshape picture" src={src} />
        </div>
      ) : (
        <EmptyState
          className="cad-agent-empty-view"
          title={setupRequired ? "Connect Onshape" : "No picture yet"}
          description={
            setupRequired
              ? "Ask a mentor to finish Onshape setup, or paste a document link to edit it in Onshape."
              : "Paste an Onshape document link to edit it here. The viewport stays empty until a document is open."
          }
          badge={setupRequired ? "Needs setup" : undefined}
          badgeTone={setupRequired ? "setup" : undefined}
          soft
        >
          {setupRequired ? (
            <Button as="a" variant="primary" href="/cad-vault#link-cad">
              Paste an Onshape link
            </Button>
          ) : null}
        </EmptyState>
      )}
    </section>
  );
}
