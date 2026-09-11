# Vantage local model relay contract

*For contributors: the contract between a hosted deployment and a model running on a team's own network. Last updated 2026-09-10.*

Hosted Vantage workers cannot reach `localhost` or a team LAN. A local model configuration therefore creates
relay jobs; it never asks Vercel to call the local URL.

The authenticated desktop relay polls/claims a job containing:

```json
{
  "jobId": "uuid",
  "operation": "invoke_llm",
  "model": "team-configured-name",
  "messages": [{ "role": "user", "content": "..." }],
  "maxTokens": 1000
}
```

It invokes the team-configured OpenAI-compatible endpoint locally and returns:

```json
{
  "jobId": "uuid",
  "content": "...",
  "promptTokens": 100,
  "completionTokens": 50,
  "providerModel": "actual-returned-model"
}
```

The relay authenticates to Vantage, may claim only its organization’s jobs, and must report actual token
usage. Local/custom calls remain visible in the usage ledger with `key_source=byo/local` and no Vantage model
charge. Vantage can recommend tested configurations, but strategy and prediction accuracy may vary with
custom models. The queue transport is intentionally adapter-neutral and is not a claim that local endpoints
are reachable from hosted workers.
