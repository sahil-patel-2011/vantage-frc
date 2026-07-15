# Fusion 360 official connector stub

This folder is the user-installed Autodesk Fusion 360 add-in boundary for the Vantage desktop relay. It is intentionally a stub until supported operations are implemented and tested against Autodesk's official Fusion API in a disposable document.

The connector must listen only on loopback, expose `/health` and `/execute`, validate the Vantage signed envelope, enforce the operation allowlist, apply idempotency, pause for approval, report progress, create a version/checkpoint, and return topology plus a rendered checkpoint. It must never accept arbitrary Python, shell strings, document deletion, or unrelated job IDs.

Do not copy this folder into Fusion and expect production geometry mutation yet. Use the deterministic mock adapter for local product tests.
