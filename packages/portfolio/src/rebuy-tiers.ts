export interface RebuyTier {
  id?: string;
  drawdownPercentage: number; // e.g. 15 means a -15% correction
  usagePercentage: number; // e.g. 20 means use 20% of available liquidity
}

export interface RebuyEvaluation {
  applicableTier: RebuyTier | null;
  suggestedAmountEur: number;
  reasoning: string;
}

// "Recompras escalonadas": pick the deepest configured drawdown tier that
// the current correction has reached, and suggest using that tier's
// percentage of the liquidity already reserved for rebuys. Never executes
// anything — purely a suggested amount for the user to act on manually.
export function evaluateRebuyTiers(
  tiers: RebuyTier[],
  currentDrawdownPercentage: number,
  availableLiquidityEur: number
): RebuyEvaluation {
  const applicable = tiers
    .filter((tier) => currentDrawdownPercentage >= tier.drawdownPercentage)
    .sort((a, b) => b.drawdownPercentage - a.drawdownPercentage)[0] ?? null;

  if (!applicable) {
    return {
      applicableTier: null,
      suggestedAmountEur: 0,
      reasoning: tiers.length === 0
        ? "No hay niveles de recompra configurados para este ciclo."
        : `La caída actual (${currentDrawdownPercentage.toFixed(1)}%) no alcanza ningún umbral configurado.`
    };
  }

  const suggestedAmountEur = Math.max(0, availableLiquidityEur) * (applicable.usagePercentage / 100);

  return {
    applicableTier: applicable,
    suggestedAmountEur,
    reasoning: `Caída de ${currentDrawdownPercentage.toFixed(1)}% activa el umbral -${applicable.drawdownPercentage}%: usar ${applicable.usagePercentage}% de la liquidez reservada (${availableLiquidityEur.toFixed(2)} €) = ${suggestedAmountEur.toFixed(2)} €.`
  };
}
