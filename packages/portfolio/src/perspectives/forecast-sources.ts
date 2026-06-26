// ─── Sistema de previsiones de analistas y medios ────────────────────────────
// Define el contrato de fuentes externas y el cálculo de consenso.
// Las previsiones ajustan los multiplicadores de ciclo del modelo de precios.

export type ForecastDirection = "very_bullish" | "bullish" | "neutral" | "bearish" | "very_bearish";
export type ForecastSourceType = "analyst" | "institution" | "media" | "model";

export interface ForecastSource {
  id: string;
  publisher: string;               // e.g. "ARK Invest", "Standard Chartered"
  sourceType: ForecastSourceType;
  assetId: string;                 // "bitcoin", "ethereum", etc.
  direction: ForecastDirection;
  targetPriceUsd?: number;         // precio objetivo USD (opcional)
  targetPriceEur?: number;         // precio objetivo EUR normalizado y versionado (opcional)
  targetYear?: number;             // año del objetivo (e.g. 2025)
  confidence: number;              // 0–1 (certeza declarada por la fuente)
  publishedAt: number;             // timestamp ms
  expiresAt: number;               // timestamp ms; null = no expira
  fxRate?: number | null;           // EUR por 1 USD usado al normalizar
  fxRateAt?: number | null;
  fxSource?: string | null;
  notes?: string;
}

// ─── Peso de fuente ───────────────────────────────────────────────────────────

// Fuentes con historial de acierto documentado reciben mayor peso.
// Se pondera también la antigüedad: cuanto más reciente, más relevante.
export function weightSource(src: ForecastSource, now: number): number {
  const sourceTypeWeight: Record<ForecastSourceType, number> = {
    institution: 1.2,
    analyst:     1.0,
    model:       0.9,
    media:       0.6,
  };

  const ageMs = now - src.publishedAt;
  const ageYears = ageMs / (365.25 * 24 * 3600 * 1000);
  // Decae exponencialmente: vida media ≈ 18 meses
  const ageFactor = Math.exp(-ageYears / 1.5);

  return sourceTypeWeight[src.sourceType] * src.confidence * ageFactor;
}

// ─── Expiración ───────────────────────────────────────────────────────────────

export function isExpired(src: ForecastSource, now: number): boolean {
  return src.expiresAt < now;
}

// ─── Puntuación direccional ───────────────────────────────────────────────────

const DIRECTION_SCORE: Record<ForecastDirection, number> = {
  very_bullish:  1.0,
  bullish:       0.5,
  neutral:       0.0,
  bearish:      -0.5,
  very_bearish: -1.0,
};

// ─── Consenso ─────────────────────────────────────────────────────────────────

export interface ForecastConsensus {
  assetId: string;
  score: number;          // [-1, +1] media ponderada de direcciones
  direction: ForecastDirection;
  sourceCount: number;
  peakMultAdjustment: number;  // factor multiplicador sobre CYCLE_PEAK_MULT del modelo
  computedAt: number;
}

/**
 * Calcula el consenso de analistas para un activo.
 * Devuelve un ajuste sobre el multiplicador de pico del modelo de precios:
 *   score ≈  +1 → adjustment ≈ +30% (bullish override)
 *   score ≈   0 → adjustment ≈   0% (sin cambio)
 *   score ≈  -1 → adjustment ≈ -30% (bearish override)
 *
 * El ajuste se aplica en price-model.ts como:
 *   effectivePeakMult = CYCLE_PEAK_MULT * (1 + consensus.peakMultAdjustment)
 */
export function buildConsensus(
  sources: ForecastSource[],
  assetId: string,
  now: number,
): ForecastConsensus {
  const active = sources.filter(
    s => s.assetId === assetId && !isExpired(s, now),
  );

  if (active.length === 0) {
    return {
      assetId, score: 0, direction: "neutral",
      sourceCount: 0, peakMultAdjustment: 0, computedAt: now,
    };
  }

  let sumWeight = 0;
  let sumScore = 0;
  for (const src of active) {
    const w = weightSource(src, now);
    sumScore  += DIRECTION_SCORE[src.direction] * w;
    sumWeight += w;
  }

  const score = sumWeight > 0 ? sumScore / sumWeight : 0;

  // El ajuste tiene un rango controlado: máx ±30% sobre el multiplicador base.
  // Esto evita que el consenso domine completamente el modelo.
  const peakMultAdjustment = score * 0.30;

  const direction: ForecastDirection =
    score >  0.6 ? "very_bullish"
    : score >  0.2 ? "bullish"
    : score < -0.6 ? "very_bearish"
    : score < -0.2 ? "bearish"
    : "neutral";

  return {
    assetId,
    score,
    direction,
    sourceCount: active.length,
    peakMultAdjustment,
    computedAt: now,
  };
}
