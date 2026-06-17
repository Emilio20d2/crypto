import type { MarketSentiment } from "./sentiment";

// Asset lifecycle/health assessment built entirely on top of the existing
// MarketSentiment engine (momentum/trend/volatility from real price history,
// Fear & Greed context) — no adoption/dev-activity/on-chain data, since none
// of that is integrated. "Fuerza relativa" is approximated by comparing the
// asset's own 30d trend signal against BTC's, both computed by the same
// MarketSentimentService so they're on the same comparable scale.
export type AssetHealthStatus = "activo" | "observacion" | "riesgo_elevado" | "salida_recomendada" | "retirado";
export type AssetTrend = "alcista" | "lateral" | "bajista";
export type AssetRiskLevel = "bajo" | "moderado" | "alto" | "muy_alto";
export type AssetStrategicState = "excelente" | "buena" | "neutral" | "vigilancia" | "deterioro" | "sustitucion_recomendada";

export interface AssetHealthInput {
  assetSentiment: MarketSentiment | null;
  btcSentiment?: MarketSentiment | null;
  isRetiredFromStrategy: boolean;
}

export interface AssetHealthResult {
  status: AssetHealthStatus;
  relativeStrengthVsBtc: number | null;
  strongEntrySignal: boolean;
  tendencia: AssetTrend | null;
  riesgoNivel: AssetRiskLevel;
  estadoEstrategico: AssetStrategicState;
  reasoning: string;
  signalsUsed: string[];
  signalsUnavailable: string[];
}

function factorScore(sentiment: MarketSentiment | null | undefined, factorId: string): number | null {
  const found = sentiment?.factors.find((item) => item.id === factorId);
  return found ? found.contribution : null;
}

function deriveTrend(direction: MarketSentiment["direction"] | undefined): AssetTrend | null {
  if (!direction) return null;
  if (direction === "very_bullish" || direction === "bullish") return "alcista";
  if (direction === "very_bearish" || direction === "bearish") return "bajista";
  return "lateral";
}

function deriveRiskLevel(status: AssetHealthStatus): AssetRiskLevel {
  if (status === "salida_recomendada") return "muy_alto";
  if (status === "riesgo_elevado") return "alto";
  if (status === "observacion") return "moderado";
  return "bajo";
}

function deriveStrategicState(status: AssetHealthStatus, strongEntrySignal: boolean): AssetStrategicState {
  if (status === "salida_recomendada") return "sustitucion_recomendada";
  if (status === "riesgo_elevado") return "deterioro";
  if (status === "observacion") return "vigilancia";
  if (status === "retirado") return "neutral";
  if (strongEntrySignal) return "excelente";
  return "buena";
}

export function assessAssetHealth(input: AssetHealthInput): AssetHealthResult {
  if (input.isRetiredFromStrategy) {
    return {
      status: "retirado",
      relativeStrengthVsBtc: null,
      strongEntrySignal: false,
      tendencia: null,
      riesgoNivel: "bajo",
      estadoEstrategico: "neutral",
      reasoning: "El activo ya está retirado de la estrategia.",
      signalsUsed: [],
      signalsUnavailable: []
    };
  }

  const used: string[] = [];
  const unavailable: string[] = [];

  const sentiment = input.assetSentiment;
  if (!sentiment) {
    unavailable.push("Sentimiento del activo (momentum/tendencia/volatilidad)");
    return {
      status: "activo",
      relativeStrengthVsBtc: null,
      strongEntrySignal: false,
      tendencia: null,
      riesgoNivel: "bajo",
      estadoEstrategico: "buena",
      reasoning: "Sin datos de sentimiento disponibles; no se puede evaluar deterioro, se asume activo por defecto.",
      signalsUsed: used,
      signalsUnavailable: unavailable
    };
  }
  used.push("Sentimiento del activo (momentum/tendencia/volatilidad)");

  const assetTrend30d = factorScore(sentiment, "trend_30d");
  const btcTrend30d = factorScore(input.btcSentiment, "trend_30d");
  const relativeStrengthVsBtc = assetTrend30d !== null && btcTrend30d !== null ? assetTrend30d - btcTrend30d : null;
  if (relativeStrengthVsBtc !== null) used.push("Fuerza relativa vs BTC (tendencia 30d)");
  else unavailable.push("Fuerza relativa vs BTC (tendencia 30d)");

  const direction = sentiment.direction;
  const sustainedUnderperformance = relativeStrengthVsBtc !== null && relativeStrengthVsBtc < -20;
  const moderateUnderperformance = relativeStrengthVsBtc !== null && relativeStrengthVsBtc < -10;

  let status: AssetHealthStatus;
  let reasoning: string;

  if (direction === "very_bearish" && sustainedUnderperformance) {
    status = "salida_recomendada";
    reasoning = "Tendencia muy bajista sostenida y pérdida significativa de fuerza relativa frente a BTC.";
  } else if (direction === "very_bearish" || (direction === "bearish" && moderateUnderperformance)) {
    status = "riesgo_elevado";
    reasoning = "Tendencia bajista combinada con debilidad frente a BTC.";
  } else if (direction === "bearish") {
    status = "observacion";
    reasoning = "Tendencia bajista, sin pérdida de fuerza relativa significativa todavía.";
  } else {
    status = "activo";
    reasoning = "Sin señales de deterioro: tendencia neutral o positiva.";
  }

  const strongEntrySignal = direction === "very_bullish" && relativeStrengthVsBtc !== null && relativeStrengthVsBtc > 20;

  const tendencia = deriveTrend(direction);
  const riesgoNivel = deriveRiskLevel(status);
  const estadoEstrategico = deriveStrategicState(status, strongEntrySignal);

  return {
    status,
    relativeStrengthVsBtc,
    strongEntrySignal,
    tendencia,
    riesgoNivel,
    estadoEstrategico,
    reasoning,
    signalsUsed: used,
    signalsUnavailable: unavailable
  };
}
