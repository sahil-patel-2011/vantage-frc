/**
 * Re-export BYOK model catalog from @vantage/agent for Soft-UI / API routes.
 */
export {
  BYOK_MODEL_OPTIONS,
  BYOK_RATES_DISCLAIMER,
  BYOK_RATES_SNAPSHOT_DATE,
  LOCAL_OPENAI_COMPAT_KIND,
  LOCAL_OPENAI_COMPAT_LABEL,
  estimateByokCostUsd,
  findByokModelOption,
  pickByokModelForFeature,
  preferredTierForFeature,
  type ByokModelOption,
  type ByokModelProvider,
  type ByokModelTier,
} from "@vantage/agent";
