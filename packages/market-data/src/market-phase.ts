// "Índice Crypto Control": an in-house heuristic, not a real on-chain
// indicator. It only ever uses data this app actually has live access to
// (Fear & Greed, global market-cap momentum, dominance, and optionally the
// user's own portfolio/altcoin performance). Premium on-chain indicators
// (MVRV, NUPL, Puell Multiple, Pi Cycle Top, Hash Ribbon) and third-party
// analyst consensus (Glassnode, CryptoQuant, etc.) are NOT integrated —
// callers must never label this output as one of those.
export type MarketPhase =
  | "acumulacion"
  | "inicio_alcista"
  | "alcista_fuerte"
  | "euforia"
  | "distribucion"
  | "bajista"
  | "capitulacion";

export interface MarketPhaseInput {
  fearGreed: number | null;
  marketCapChangePercentage24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  portfolioRoiPercentage?: number | null;
  altcoinPerformanceVsBtc?: number | null;
}

export interface MarketPhaseResult {
  phase: MarketPhase | null;
  confidence: "alta" | "media" | "baja";
  indicatorsUsed: string[];
  indicatorsUnavailable: string[];
  reasoning: string;
}

const PREMIUM_INDICATORS_UNAVAILABLE = [
  "MVRV (requiere fuente on-chain no integrada)",
  "NUPL (requiere fuente on-chain no integrada)",
  "Puell Multiple (requiere fuente on-chain no integrada)",
  "Pi Cycle Top (requiere fuente on-chain no integrada)",
  "Hash Ribbon (requiere fuente on-chain no integrada)",
  "Consenso de analistas: Glassnode/CryptoQuant/IntoTheBlock/CoinShares/Santiment/Messari (sin credenciales configuradas)"
];

function trackAvailability(label: string, value: number | null | undefined, used: string[], unavailable: string[]): void {
  if (typeof value === "number" && Number.isFinite(value)) used.push(label);
  else unavailable.push(label);
}

export function classifyMarketPhase(input: MarketPhaseInput): MarketPhaseResult {
  const used: string[] = [];
  const unavailable: string[] = [...PREMIUM_INDICATORS_UNAVAILABLE];

  trackAvailability("Fear & Greed", input.fearGreed, used, unavailable);
  trackAvailability("Variación Market Cap global 24h", input.marketCapChangePercentage24h, used, unavailable);
  trackAvailability("Dominancia BTC", input.btcDominance, used, unavailable);
  trackAvailability("Dominancia ETH", input.ethDominance, used, unavailable);
  trackAvailability("Estado de la cartera (ROI)", input.portfolioRoiPercentage, used, unavailable);
  trackAvailability("Estado de las altcoins vs BTC", input.altcoinPerformanceVsBtc, used, unavailable);

  const fg = input.fearGreed;
  if (fg === null || !Number.isFinite(fg)) {
    return {
      phase: null,
      confidence: "baja",
      indicatorsUsed: used,
      indicatorsUnavailable: unavailable,
      reasoning: "Fear & Greed no disponible: es la señal base del Índice Crypto Control y no se estima sin él."
    };
  }

  const mc = input.marketCapChangePercentage24h;
  let phase: MarketPhase;

  if (fg >= 80) {
    phase = mc !== null && mc < 0 ? "distribucion" : "euforia";
  } else if (fg >= 65) {
    phase = mc !== null && mc > 1 ? "alcista_fuerte" : mc !== null && mc <= 0 ? "distribucion" : "alcista_fuerte";
  } else if (fg >= 45) {
    phase = mc !== null && mc < -2 ? "bajista" : "inicio_alcista";
  } else if (fg >= 25) {
    phase = mc !== null && mc < -2 ? "bajista" : "acumulacion";
  } else if (fg >= 16) {
    phase = mc !== null && mc > 0 ? "acumulacion" : "bajista";
  } else {
    phase = mc !== null && mc > 2 ? "acumulacion" : "capitulacion";
  }

  const confidence: MarketPhaseResult["confidence"] =
    mc !== null && input.btcDominance !== null && input.ethDominance !== null ? "alta" :
    mc !== null ? "media" : "baja";

  const reasoning = `Fear & Greed=${fg}` + (mc !== null ? ` · variación Market Cap 24h=${mc.toFixed(2)}%` : " (sin variación de Market Cap disponible)") + ". Análisis propio Crypto Control, no sustituye indicadores on-chain ni consenso de analistas.";

  return { phase, confidence, indicatorsUsed: used, indicatorsUnavailable: unavailable, reasoning };
}
