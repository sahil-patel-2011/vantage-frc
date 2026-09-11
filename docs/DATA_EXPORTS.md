# Exports

*For team admins who want their data out, and anyone asking what leaves the system. Last reviewed
September 2026.*

Your team's data is yours. **Exports** (`/exports`) packages it as ordinary CSV files you can open
in any spreadsheet.

## What you get

A ZIP archive, encrypted and private to the person who requested it, containing:

- **CSV files** — UTF-8, standard RFC 4180 format, one per data set
- **`manifest.json`** — the format version, when the export was generated (UTC), what it covers, and
  a description of every file and its columns

Columns whose name ends in `_json` hold structured data as compact JSON. Any cell that starts with
`=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet cannot execute it as a formula.

## What a team export covers

Scouting (match, pit and disagreement records), the public reference data your team used (teams,
events, matches, statistics), research provenance, pick lists, display settings, live alerts,
team-shared AI conversations and the artifacts they produced, AI usage and the credit ledger, and
membership and invitation status.

A **private export** contains only the requesting person's own AI conversations and memory.

## What is never exported

API keys, sign-in and session tokens, invitation and display tokens, passwords, one-time codes,
MFA secrets or their hashes, encrypted secrets, key-management material, and payment credentials.
Every export selects an explicit list of allowed columns; new data sets are added to exports only
with a documented schema version.

## How it runs

An export is a background job. It is rate-limited, recorded in the audit log, and can be cancelled.
When it finishes you are notified and given a short-lived signed download link. After the link
expires, the archive's contents are purged.
