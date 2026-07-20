-- Platform-sponsored / promotional free-tier AI ledger path ($0 Vantage charge).
-- Keys live in env (CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, COHERE_API_KEY) — never in SQL.
ALTER TYPE key_source ADD VALUE IF NOT EXISTS 'sponsored';
