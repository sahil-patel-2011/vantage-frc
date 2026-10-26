import "../app/product-hub.css";

/**
 * Instant stand-in for a signed-in page while its content streams in.
 * The title matches the page, and the blocks match a card layout, so navigation
 * is not a blank frame. Real data replaces this; the blocks are not numbers.
 */
export function RouteLoading({ title }: { title: string }) {
  return (
    <main className="module-page route-loading" aria-busy="true">
      <header className="app-page-header">
        <div>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="hub-panel-skeleton" role="status" aria-label={`Loading ${title}`}>
        <div className="hub-skel-head" aria-hidden="true">
          <i className="is-label" />
          <i className="is-title" />
        </div>
        <div className="hub-skel-grid" aria-hidden="true">
          {[0, 1, 2].map((column) => (
            <div className="hub-skel-card" key={column}>
              <i className="is-label" />
              <i className="is-title" />
              <i className="is-row" />
              <i className="is-row is-short" />
              <i className="is-row" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
