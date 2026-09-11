# Base44 bridge policy

Production routing is disabled by default. Vantage will not pool, resell, or relabel Base44 workspace integration credits as Vantage Credits. Enablement requires written Base44/OEM approval reference/date, explicit platform-admin acknowledgement, a passing narrow health test, a platform feature flag, internal quotas, and a configured HMAC secret.

Official interfaces:

- [Base44 SDK client](https://docs.base44.com/developers/references/sdk/getting-started/client)
- [`createClient({ appId })`](https://docs.base44.com/developers/references/sdk/docs/functions/createClient)
- [`createClientFromRequest(req)` for Base44-hosted functions](https://docs.base44.com/developers/references/sdk/docs/functions/createClientFromRequest)
- [`integrations.Core.InvokeLLM`](https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations)
- [Built-in integrations](https://docs.base44.com/Integrations/built-in-integrations)
- [Credits](https://docs.base44.com/Account-and-billing/Credits)
- [Terms of Service](https://base44.com/terms-of-service)

The documented external client is app-scoped. Service-role access exists only inside Base44-hosted backend functions. There is no assumed standalone InvokeLLM REST/service credential. The only proposed production shape is a narrowly scoped Base44 backend function that calls `createClientFromRequest(req)` and then `base44.integrations.Core.InvokeLLM(...)`.

Vantage's bridge request is internal and typed: request/org/user/feature, configured model mapping, bounded messages/max tokens, timestamp, nonce, and HMAC signature. It is not an anonymous or generic LLM proxy. The bridge must verify authorization, timestamp, nonce replay, feature/model allowlists and quota; enforce timeouts; redact logs; and return usage only when Base44 provides it. Exhaustion and 429 responses fail/back off without debiting a Vantage wallet.

Model IDs remain configuration, not inventions. Current documented examples include `gpt_5_mini`, `gpt_5_4`, `gpt_5_5`, `gemini_3_flash`, `gemini_3_1_pro`, `claude_sonnet_4_6`, and `claude_opus_4_6`, `claude_opus_4_7`, `claude_opus_4_8`.

Before approval, ask Base44 support in writing whether this Vantage use, multi-organization end users, backend function bridge, expected volume, and any OEM/resale arrangement are permitted; what quota/rate commitments apply; what usage fields are returned; and how credit exhaustion should be detected.
