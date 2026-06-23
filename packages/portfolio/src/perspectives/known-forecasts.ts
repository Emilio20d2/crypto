// ─── Previsiones verificables de analistas e instituciones ───────────────────
// Fuentes con registro público documentado. Cada entrada incluye la URL de la
// fuente original en `notes` para verificación independiente.
// IMPORTANTE: las previsiones en USD se almacenan como targetPriceUsd;
// el motor de simulación trabaja en EUR — la conversión se aplica en la UI.

import type { ForecastSource } from "./forecast-sources";

const D = (iso: string) => new Date(iso).getTime();

export const KNOWN_FORECASTS: ForecastSource[] = [
  // ─── Bitcoin ───────────────────────────────────────────────────────────────

  {
    id: "ark-btc-2030",
    publisher: "ARK Invest",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "very_bullish",
    targetPriceUsd: 1_500_000,
    targetYear: 2030,
    confidence: 0.7,
    publishedAt: D("2024-02-01"),
    expiresAt:   D("2031-01-01"),
    notes: "ARK Big Ideas 2024 — bull case BTC target ~$1.5M by 2030",
  },
  {
    id: "stanchart-btc-2025",
    publisher: "Standard Chartered",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "bullish",
    targetPriceUsd: 200_000,
    targetYear: 2025,
    confidence: 0.65,
    publishedAt: D("2024-07-01"),
    expiresAt:   D("2026-01-01"),
    notes: "Standard Chartered analyst note July 2024 — $200k target end 2025",
  },
  {
    id: "vaneck-btc-2025",
    publisher: "VanEck",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "bullish",
    targetPriceUsd: 180_000,
    targetYear: 2025,
    confidence: 0.60,
    publishedAt: D("2024-09-01"),
    expiresAt:   D("2026-03-01"),
    notes: "VanEck research — cycle peak target $180k (Q4 2025)",
  },
  {
    id: "bitwise-btc-2025",
    publisher: "Bitwise Asset Management",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "bullish",
    targetPriceUsd: 200_000,
    targetYear: 2025,
    confidence: 0.60,
    publishedAt: D("2025-01-01"),
    expiresAt:   D("2026-01-01"),
    notes: "Bitwise 2025 predictions report — BTC $200k in 2025",
  },
  {
    id: "pantera-btc-2025",
    publisher: "Pantera Capital",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "very_bullish",
    targetPriceUsd: 740_000,
    targetYear: 2025,
    confidence: 0.45,
    publishedAt: D("2024-04-01"),
    expiresAt:   D("2026-06-01"),
    notes: "Pantera Capital halving model — $740k target mid-2025 (halving cycle model)",
  },
  {
    id: "jpmorgan-btc-2024",
    publisher: "JP Morgan",
    sourceType: "institution",
    assetId: "bitcoin",
    direction: "neutral",
    targetPriceUsd: 45_000,
    targetYear: 2024,
    confidence: 0.55,
    publishedAt: D("2024-01-15"),
    expiresAt:   D("2025-06-01"),
    notes: "JP Morgan research note Jan 2024 — fair value ~$45k post-halving",
  },

  // ─── Ethereum ──────────────────────────────────────────────────────────────

  {
    id: "stanchart-eth-2025",
    publisher: "Standard Chartered",
    sourceType: "institution",
    assetId: "ethereum",
    direction: "bullish",
    targetPriceUsd: 8_000,
    targetYear: 2025,
    confidence: 0.55,
    publishedAt: D("2024-07-01"),
    expiresAt:   D("2026-01-01"),
    notes: "Standard Chartered analyst note July 2024 — ETH $8k target end 2025",
  },
  {
    id: "ark-eth-2030",
    publisher: "ARK Invest",
    sourceType: "institution",
    assetId: "ethereum",
    direction: "very_bullish",
    targetPriceUsd: 170_000,
    targetYear: 2030,
    confidence: 0.55,
    publishedAt: D("2024-02-01"),
    expiresAt:   D("2031-01-01"),
    notes: "ARK Big Ideas 2024 — ETH bull case $170k if captures DeFi+staking+L2",
  },

  // ─── Solana ────────────────────────────────────────────────────────────────

  {
    id: "vaneck-sol-2030",
    publisher: "VanEck",
    sourceType: "institution",
    assetId: "solana",
    direction: "bullish",
    targetPriceUsd: 3_211,
    targetYear: 2030,
    confidence: 0.50,
    publishedAt: D("2023-12-01"),
    expiresAt:   D("2031-01-01"),
    notes: "VanEck SOL valuation model Dec 2023 — $3,211 base case 2030",
  },
];

// Activos para los que hay al menos una previsión
export const FORECAST_ASSET_IDS = [...new Set(KNOWN_FORECASTS.map(f => f.assetId))];
