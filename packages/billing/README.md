# @vantage/billing

Credit enforcement, the usage ledger, bring-your-own-key encryption, and the
Stripe contract.

## Every model call goes through `meteredAI`

Not "should" — there is no other supported way to call a provider from product
code. `meteredAI` locks the org's billing row, sums the ledger, enforces the
cap, runs your `invoke`, and appends a usage event, all inside the transaction
`withRls` already opened.

```ts
await withRls({ userId, orgId }, async (client) =>
  meteredAI({
    client,
    orgId,
    userId,
    feature: "match_brief",
    requestId,
    estimatedCostUsd,
    invoke: async (keySource) => callTheProvider(keySource),
  }),
);
```

**There is no denormalised credit counter.** Balance is the sum of
`ai_usage_events`, every time. A cached total is a number that can be wrong,
and a billing number that can be wrong is worse than a slow one.

## Things that look like bugs and are not

**Concurrent calls for one org do not queue.** The advisory lock is taken
without blocking. A season report can hold the AI bridge for minutes, and
waiting on it would freeze every other metered call for that team. An
unserialised call checks its cap against committed usage and records
`meteringSerialized: false`. Overshoot is bounded by the sum of in-flight
estimates — never unbounded.

**One `requestId` may be metered once.** A separate request-scoped lock makes
concurrent retries wait for the first transaction and then see its committed
row, so a retry storm bills once and raises `DuplicateMeteredRequestError`.

**`keySource: "local_cli"` bills nothing.** Cost is recorded as zero and caps
are skipped: the compute is not ours. The same principle applies to a team's
own BYOK keys — prefer that path and do not spend hosted credits on it, even
on a paid tier.

## Keys

Team-supplied provider keys are envelope-encrypted before they touch the
database, and the local KMS refuses to initialise in production, so a
misconfigured deploy fails loudly instead of storing keys weakly.

## Layout

| File | What it holds |
| --- | --- |
| `index.ts` | `meteredAI`, the ledger write, the Stripe contract |
| `allowance.ts` | `readOrgAllowance` — what a team has left, from the ledger |

Plan shapes and what each tier includes: [`docs/PRICING.md`](../../docs/PRICING.md).
