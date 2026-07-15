"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="legal">
      <span className="section-id">SIGNAL INTERRUPTED</span>
      <h1>Something went off course.</h1>
      <p>The waitlist may still be available after a retry. No information was sent by this error screen.</p>
      <button className="button primary" onClick={reset}>Try again</button>
    </main>
  );
}
