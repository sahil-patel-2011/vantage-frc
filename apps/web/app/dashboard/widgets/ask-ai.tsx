"use client";

export function AskAiWidget({ href }: { href: string }) {
  return (
    <form
      className="dash-ask-ai"
      onSubmit={(event) => {
        event.preventDefault();
        const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
        const next = q ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : href;
        window.location.href = next;
      }}
    >
      <label>
        Ask your team helper
        <input name="q" placeholder="Why is this bracket heavy?" />
      </label>
      <button className="is-primary" type="submit">
        Ask
      </button>
    </form>
  );
}
