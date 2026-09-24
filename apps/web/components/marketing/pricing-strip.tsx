/**
 * What Vantage costs, on the landing page and /for-teams: nothing.
 *
 * There are no plans to choose between right now. Every team gets every feature for free, and
 * AI runs on the team's own key (or a free one, or a model on a shop computer, or not at all).
 * The section used to show a ladder of monthly hosted-AI tiers, which read as "this costs money"
 * to a mentor skimming it. Server component, no client JS.
 */

const AI_WAYS = [
  {
    title: "Your own key",
    body: "Paste an OpenAI, Anthropic, Google or OpenRouter key. The provider bills you directly, usually cents a week.",
  },
  {
    title: "A free key",
    body: "Google AI Studio, OpenRouter and Groq all have free tiers that work as a team key.",
  },
  {
    title: "A shop computer",
    body: "Point Vantage at Ollama or LM Studio and the AI runs on your own hardware.",
  },
  {
    title: "No AI at all",
    body: "Scouting, strategy, the build and the budget all work without it.",
  },
] as const;

export function PricingStrip({ headingId }: { headingId: string }) {
  return (
    <section className="mk-price mk-free" id="cost" aria-labelledby={headingId}>
      <div className="lux-content">
        <header className="lux-section-head" data-reveal>
          <p className="lux-eyebrow">What it costs</p>
          <h2 id={headingId}>Free for every team. Bring your own AI key.</h2>
          <p>
            Every feature is included for every team, with no plans and no card. The only thing that can cost money is
            AI, and that goes on your own key, so you see the bill and you set the limit.
          </p>
        </header>

        <ul className="mk-price-grid mk-free-grid" data-reveal>
          {AI_WAYS.map((way) => (
            <li key={way.title}>
              <span className="mk-price-label">{way.title}</span>
              <span className="mk-price-blurb">{way.body}</span>
            </li>
          ))}
        </ul>

        <div className="mk-price-foot" data-reveal>
          <p>Every feature, every team, no card.</p>
          <a className="button secondary" href="/pricing">
            How AI keys work
          </a>
        </div>
      </div>
    </section>
  );
}
