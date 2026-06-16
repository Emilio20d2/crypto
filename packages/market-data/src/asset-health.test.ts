import { describe, test, expect } from "vitest";
import { assessAssetHealth } from "./asset-health";
import type { MarketSentiment, SentimentFactor } from "./sentiment";

function makeFactor(id: string, contribution: number): SentimentFactor {
  return { id, label: id, signal: "neutral", weight: 1, contribution, value: null, source: "test", updatedAt: null };
}

function makeSentiment(direction: MarketSentiment["direction"], trend30dContribution: number | null): MarketSentiment {
  return {
    scope: "asset",
    direction,
    score: 0,
    confidence: 1,
    timeframe: "30d",
    factors: trend30dContribution === null ? [] : [makeFactor("trend_30d", trend30dContribution)],
    sourceSummary: [],
    calculatedAt: Date.now(),
    validUntil: null,
    state: "live"
  };
}

describe("assessAssetHealth", () => {
  test("retirado de la estrategia no se analiza", () => {
    const result = assessAssetHealth({ assetSentiment: makeSentiment("bearish", -10), isRetiredFromStrategy: true });
    expect(result.status).toBe("retirado");
  });

  test("sin datos de sentimiento: activo por defecto, nunca se inventa deterioro", () => {
    const result = assessAssetHealth({ assetSentiment: null, isRetiredFromStrategy: false });
    expect(result.status).toBe("activo");
    expect(result.signalsUnavailable).toContain("Sentimiento del activo (momentum/tendencia/volatilidad)");
  });

  test("salida recomendada: muy bajista y muy por detrás de BTC", () => {
    const result = assessAssetHealth({
      assetSentiment: makeSentiment("very_bearish", -40),
      btcSentiment: makeSentiment("bearish", -5),
      isRetiredFromStrategy: false
    });
    expect(result.status).toBe("salida_recomendada");
    expect(result.relativeStrengthVsBtc).toBeCloseTo(-35);
  });

  test("riesgo elevado: bajista con debilidad moderada frente a BTC", () => {
    const result = assessAssetHealth({
      assetSentiment: makeSentiment("bearish", -20),
      btcSentiment: makeSentiment("neutral", -5),
      isRetiredFromStrategy: false
    });
    expect(result.status).toBe("riesgo_elevado");
  });

  test("observación: bajista pero sin debilidad relativa marcada", () => {
    const result = assessAssetHealth({
      assetSentiment: makeSentiment("bearish", -5),
      btcSentiment: makeSentiment("neutral", -2),
      isRetiredFromStrategy: false
    });
    expect(result.status).toBe("observacion");
  });

  test("activo: tendencia neutral o positiva", () => {
    const result = assessAssetHealth({ assetSentiment: makeSentiment("bullish", 10), isRetiredFromStrategy: false });
    expect(result.status).toBe("activo");
  });

  test("señal de entrada fuerte: muy alcista y muy por delante de BTC", () => {
    const result = assessAssetHealth({
      assetSentiment: makeSentiment("very_bullish", 40),
      btcSentiment: makeSentiment("neutral", 5),
      isRetiredFromStrategy: false
    });
    expect(result.strongEntrySignal).toBe(true);
  });

  test("sin sentimiento de BTC disponible: fuerza relativa no se inventa", () => {
    const result = assessAssetHealth({ assetSentiment: makeSentiment("bearish", -20), isRetiredFromStrategy: false });
    expect(result.relativeStrengthVsBtc).toBeNull();
    expect(result.signalsUnavailable).toContain("Fuerza relativa vs BTC (tendencia 30d)");
  });
});
