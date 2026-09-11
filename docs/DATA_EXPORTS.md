# Export Center data dictionary

Exports are UTF-8, RFC 4180 CSV files inside an encrypted private ZIP. `manifest.json` records format version, UTC generation time, privacy scope, file names, descriptions, and stable columns. JSON columns end in `_json` and contain compact JSON; adapters may add documented flattened columns in later versions. Cells beginning with `=`, `+`, `-`, or `@` are prefixed with an apostrophe to prevent spreadsheet formula execution.

Team exports cover existing scouting match/pit/disagreement data, platform reference teams/events/matches/metrics, org-billed research provenance, pick lists, display configuration, live alerts, team-shared AI messages, AI artifacts/provenance, usage, wallet ledger, and membership/invite status. Private exports contain only the requesting user's private AI conversations and memory.

Adapters explicitly select allowlisted columns. API keys, OAuth/session/display/invite tokens, password/OTP/MFA values or hashes, encrypted secrets, KMS material, and payment credentials are not exportable. Future modules add an adapter and schema version before appearing in “Export all.”

Jobs are rate-limited, auditable, cancellable, chunk CSV rows, notify on completion, issue a short-lived signed download token, and purge encrypted archive content after expiry.
