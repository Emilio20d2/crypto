import { describe, test, expect } from "vitest";
import { classifyMarketPhase } from "./market-phase";

const base = { fearGreed: null, marketCapChangePercentage24h: null, btcDominance: null, ethDominance: null };

describe("classifyMarketPhase — Índice Crypto Control", () => {
  test("sin Fear & Greed: incertidumbre, confianza baja, nunca se inventa", () => {
    const result = classifyMarketPhase(base);
    expect(result.phase).toBe("incertidumbre");
    expect(result.confidence).toBe("baja");
  });

  test("nunca declara disponibles los indicadores premium no integrados", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 50 });
    expect(result.indicatorsUnavailable).toContain("MVRV (requiere fuente on-chain no integrada)");
    expect(result.indicatorsUsed).not.toContain("MVRV");
  });

  test("euforia: Fear & Greed extremo y momentum positivo", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 90, marketCapChangePercentage24h: 3 });
    expect(result.phase).toBe("euforia");
  });

  test("distribución: sentimiento extremo pero momentum ya negativo", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 85, marketCapChangePercentage24h: -1.5 });
    expect(result.phase).toBe("distribucion");
  });

  test("alcista fuerte: greed alto y momentum claramente positivo", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 70, marketCapChangePercentage24h: 2 });
    expect(result.phase).toBe("alcista_fuerte");
  });

  test("distribución también desde greed alto con momentum negativo", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 70, marketCapChangePercentage24h: -1 });
    expect(result.phase).toBe("distribucion");
  });

  test("inicio alcista: sentimiento neutral-positivo sin caída fuerte", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 55, marketCapChangePercentage24h: 0.5 });
    expect(result.phase).toBe("inicio_alcista");
  });

  test("corrección: sentimiento neutral pero pullback pronunciado (no bear sostenido)", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 50, marketCapChangePercentage24h: -3 });
    expect(result.phase).toBe("correccion");
  });

  test("bajista: miedo moderado y caída de market cap pronunciada", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 35, marketCapChangePercentage24h: -3 });
    expect(result.phase).toBe("bajista");
  });

  test("acumulación: miedo moderado sin caída fuerte", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 30, marketCapChangePercentage24h: 0 });
    expect(result.phase).toBe("acumulacion");
  });

  test("recuperación: miedo extremo pero precio ya rebotando positivamente", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 20, marketCapChangePercentage24h: 1 });
    expect(result.phase).toBe("recuperacion");
  });

  test("recuperación también desde FG muy bajo con rebote fuerte", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 8, marketCapChangePercentage24h: 4 });
    expect(result.phase).toBe("recuperacion");
  });

  test("capitulación: miedo extremo profundo sin señales de recuperación", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 10, marketCapChangePercentage24h: -4 });
    expect(result.phase).toBe("capitulacion");
  });

  test("confianza alta solo cuando dominancia BTC/ETH y momentum están disponibles", () => {
    const result = classifyMarketPhase({ fearGreed: 50, marketCapChangePercentage24h: 1, btcDominance: 52, ethDominance: 17 });
    expect(result.confidence).toBe("alta");
  });

  test("confianza baja con solo Fear & Greed", () => {
    const result = classifyMarketPhase({ ...base, fearGreed: 50 });
    expect(result.confidence).toBe("baja");
  });
});
