"""Merge production DB/auth keys into apps/web/.env.local for local Next.

Never prints secret values. Keeps the dual Freebuff tunnel URLs.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ENV = ROOT / "apps" / "web" / ".env.local"
PROD_ENV = ROOT / ".env.vercel.production"

SKIP_PREFIXES = ("VERCEL", "NX_", "TURBO_")
SKIP_KEYS = {
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_TARGET_ENV",
    "VERCEL_OIDC_TOKEN",
}

OVERRIDES = {
    "BETTER_AUTH_URL": "http://localhost:3001",
    "NEXT_PUBLIC_APP_URL": "http://localhost:3001",
    "NEXT_PUBLIC_SITE_URL": "http://localhost:3001",
    "AUTH_TRUSTED_ORIGINS": "http://localhost:3001",
    "ENABLE_EMAIL_2FA_BYPASS": "true",
    "FREE_RELAY_BASE_URL": (
        "https://road-merge-brings-fewer.trycloudflare.com/v1,"
        "https://brass-instantly-withdrawal-cases.trycloudflare.com/v1"
    ),
}


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value
    return values


def main() -> None:
    merged = parse_env(PROD_ENV)
    existing = parse_env(WEB_ENV)
    # Keep the already-configured relay key if production dump has none.
    for key, value in existing.items():
        if key.startswith("FREE_RELAY_") and key not in OVERRIDES:
            merged[key] = value
    for key in list(merged):
        if key in SKIP_KEYS or key.startswith(SKIP_PREFIXES):
            del merged[key]
    merged.update(OVERRIDES)
    required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "FREE_RELAY_API_KEY", "FREE_RELAY_BASE_URL"]
    missing = [key for key in required if not merged.get(key, "").strip()]
    if missing:
        raise SystemExit(f"missing required keys: {', '.join(missing)}")
    lines = [f"{key}={merged[key]}" for key in sorted(merged)]
    WEB_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {WEB_ENV} keys={len(merged)} relay_urls=2")


if __name__ == "__main__":
    main()
