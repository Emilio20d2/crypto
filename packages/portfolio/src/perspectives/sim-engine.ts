// ─── Motor de simulación mensual — Perspectivas (nuevo, desde cero) ──────────
// Implementa la fórmula correcta:
//   valor futuro = cantidad_acumulada × precio_previsto
// No usa: capital × tasa_general

import type {
  SimInput, SimOptions, MonthlyState, AssetSimState, SimLot,
  AnnualSnapshot, AnnualAssetPosition, SimEvent, ScenarioResult,
  ScenarioSummary, AssetSimSummary, SimCycle, SimCycleAsset,
  SimSaleRule, SimRebuyTier, SimSubstitution, PerspectivesSimulation,
  ValidationResult,
} from "./types";
import { SIM_SCENARIOS, SCENARIO_LABELS, DEFAULT_SIM_OPTIONS } from "./types";
import { buildPriceMap, monthKey } from "./price-model";

// ─── FIFO helpers ─────────────────────────────────────────────────────────────

function consumeFifo(
  lots: SimLot[],
  quantityToSell: number,
): { consumed: Array<{ lot: SimLot; qty: number; costEur: number }>; totalCostEur: number } {
  const consumed: Array<{ lot: SimLot; qty: number; costEur: number }> = [];
  let remaining = quantityToSell;
  let totalCostEur = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.remaining <= 0) continue;
    const qty = Math.min(lot.remaining, remaining);
    const costEur = qty * lot.costPerUnitEur;
    consumed.push({ lot, qty, costEur });
    totalCostEur += costEur;
    lot.remaining -= qty;
    remaining -= qty;
  }

  return { consumed, totalCostEur };
}

function calcAvgCost(lots: SimLot[]): number | null {
  const totalQty = lots.reduce((s, l) => s + l.remaining, 0);
  if (totalQty <= 0) return null;
  const totalCost = lots.reduce((s, l) => s + l.remaining * l.costPerUnitEur, 0);
  return totalCost / totalQty;
}

// ─── Cálculo de impuesto ─────────────────────────────────────────────────────

function calcTax(gainEur: number, options: SimOptions): number {
  if (gainEur <= 0) return 0;
  let tax = 0;
  let remaining = gainEur;
  let prevBand = 0;
  for (const band of options.taxBands) {
    const bandSize = band.upToEur != null ? band.upToEur - prevBand : Infinity;
    const taxable = Math.min(remaining, bandSize);
    tax += taxable * band.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
    prevBand = band.upToEur ?? 0;
  }
  return tax;
}

// ─── Cálculo de patrimonio neto mensual ──────────────────────────────────────

function calcNetWealth(
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  assetIds: string[],
  mKey: string,
): number {
  let gross = 0;
  for (const assetId of assetIds) {
    const s = state.assetStates[assetId];
    if (!s || s.balance <= 0) continue;
    const price = prices[assetId]?.[mKey] ?? 0;
    gross += s.balance * price;
  }
  gross += state.eurcFree + state.eurcFiscalReserve + state.eurCash;
  return gross;
}

// ─── Inicialización del estado mensual desde input ───────────────────────────

let _lotCounter = 0;
function nextLotId(prefix: string): string {
  return `${prefix}-${++_lotCounter}`;
}

function initState(input: SimInput): MonthlyState {
  _lotCounter = 0;
  const assetStates: Record<string, AssetSimState> = {};

  for (const pos of input.currentPositions) {
    if (pos.assetId === "EURC" || pos.assetId === "EUR") continue;
    if (pos.balance <= 0) continue;

    // Build lots from historical lots
    const historicalLots: SimLot[] = input.currentLots
      .filter(l => l.assetId === pos.assetId && l.remainingAmount > 0)
      .map(l => ({
        id: l.id,
        assetId: l.assetId,
        acquiredAt: l.date,
        quantity: l.remainingAmount,
        remaining: l.remainingAmount,
        costPerUnitEur: l.unitAcquisitionPriceEur,
        source: "historical" as const,
      }))
      .sort((a, b) => a.acquiredAt - b.acquiredAt);

    // If no lots but has balance, create synthetic lot from avgCost
    if (historicalLots.length === 0 && pos.balance > 0 && pos.avgCostEur != null) {
      historicalLots.push({
        id: `synthetic-${pos.assetId}`,
        assetId: pos.assetId,
        acquiredAt: Date.now() - 365 * 24 * 3600 * 1000,
        quantity: pos.balance,
        remaining: pos.balance,
        costPerUnitEur: pos.avgCostEur,
        source: "historical",
      });
    }

    assetStates[pos.assetId] = {
      assetId: pos.assetId,
      balance: pos.balance,
      lots: historicalLots,
      avgCostEur: pos.avgCostEur,
      peakPriceEur: pos.currentPriceEur ?? null,
      lastSalePriceEur: null,
      totalBought: 0,
      totalSold: 0,
      totalRebuys: 0,
      goalReached: false,
      failed: false,
      deteriorated: false,
      usedRebuyTierIds: new Set(),
      usedSaleProposalIds: new Set(),
    };
  }

  // Also initialize assets in plan that aren't yet in portfolio
  for (const cycle of input.cycles) {
    for (const ca of cycle.assets) {
      if (!assetStates[ca.assetId] && ca.assetId !== "EURC" && ca.assetId !== "EUR") {
        assetStates[ca.assetId] = {
          assetId: ca.assetId,
          balance: 0,
          lots: [],
          avgCostEur: null,
          peakPriceEur: null,
          lastSalePriceEur: null,
          totalBought: 0,
          totalSold: 0,
          totalRebuys: 0,
          goalReached: false,
          failed: false,
          deteriorated: false,
          usedRebuyTierIds: new Set(),
          usedSaleProposalIds: new Set(),
        };
      }
    }
  }

  return {
    monthDate: input.now,
    assetStates,
    eurcFree: input.eurcFree,
    eurcFiscalReserve: input.eurcFiscalReserve,
    eurCash: input.eurCash,
    events: [],
    monthContributionsEur: 0,
    monthSalesEur: 0,
    monthRebuysEur: 0,
    monthCommissionsEur: 0,
    monthTaxEur: 0,
    monthEurcReinvestedEur: 0,
    cumulativeContributionsEur: 0,
    cumulativeSalesEur: 0,
    cumulativeRebuysEur: 0,
    cumulativeTaxEur: 0,
    cumulativeCommissionsEur: 0,
  };
}

// ─── Obtener el ciclo activo para una fecha ───────────────────────────────────

function getActiveCycle(cycles: SimCycle[], date: number): SimCycle | null {
  // Sort by priority (lowest number = highest priority), then pick ones whose date range covers `date`
  const active = cycles.filter(c =>
    c.startDate <= date && (c.endDate == null || c.endDate > date)
  );
  if (active.length === 0) return null;
  return active[0]; // first active (already ordered by priority from input)
}

function getActiveCycleAssets(cycle: SimCycle, date: number): SimCycleAsset[] {
  return cycle.assets.filter(a =>
    a.startDate <= date &&
    (a.endDate == null || a.endDate > date) &&
    (a.status === "active" || a.status === "goal_reached")
  );
}

// ─── Distribución mensual de aportaciones ────────────────────────────────────

interface Allocation {
  assetId: string;
  amountEur: number;
}

function distributeMonthly(
  cycle: SimCycle,
  cycleAssets: SimCycleAsset[],
  monthlyBudget: number,
  assetStates: Record<string, AssetSimState>,
): Allocation[] {
  // Exclude goal-reached and failed/deteriorated
  const eligible = cycleAssets.filter(ca => {
    const st = assetStates[ca.assetId];
    if (!st) return true;
    if (st.goalReached || st.failed || st.deteriorated) return false;
    return true;
  });

  if (eligible.length === 0) return [];

  // Resolve allocation percentages
  const totalPct = eligible.reduce((s, ca) => {
    const pct = ca.allocationType === "percentage"
      ? (ca.allocationPercentage ?? ca.allocationValue)
      : 0;
    return s + pct;
  }, 0);

  const allocations: Allocation[] = [];
  let allocated = 0;

  for (let i = 0; i < eligible.length; i++) {
    const ca = eligible[i];
    let amountEur: number;

    if (ca.allocationType === "amount" || ca.fixedAmountEur != null) {
      amountEur = ca.fixedAmountEur ?? ca.allocationValue;
    } else {
      const pct = (ca.allocationPercentage ?? ca.allocationValue);
      if (totalPct <= 0) {
        amountEur = monthlyBudget / eligible.length;
      } else {
        amountEur = monthlyBudget * (pct / totalPct);
      }
    }

    // Last item absorbs rounding
    if (i === eligible.length - 1) {
      amountEur = Math.max(0, monthlyBudget - allocated);
    }

    amountEur = Math.max(0, amountEur);
    if (amountEur >= 0.01) {
      allocations.push({ assetId: ca.assetId, amountEur });
      allocated += amountEur;
    }
  }

  return allocations;
}

// ─── Evaluación de ventas ─────────────────────────────────────────────────────

function evaluateSales(
  cycle: SimCycle,
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
  options: SimOptions,
  date: number,
): void {
  if (options.policy === "plan_base") return;

  for (const rule of cycle.saleRules) {
    if (rule.status !== "active") continue;

    const assetId = rule.assetId;
    if (!assetId) continue;

    const st = state.assetStates[assetId];
    if (!st || st.balance <= 0 || st.failed) continue;

    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;

    const avgCost = st.avgCostEur;
    if (avgCost == null || avgCost <= 0) continue;

    let triggered = false;
    if (rule.triggerType === "gain_multiple") {
      triggered = priceEur >= avgCost * rule.triggerValue;
    } else if (rule.triggerType === "price_target") {
      triggered = priceEur >= rule.triggerValue;
    }

    if (!triggered) continue;
    if (rule.triggeredAt != null) continue; // already triggered once, skip

    const sellPct = Math.min(rule.sellPercentage, 99) / 100;
    const quantityToSell = st.balance * sellPct;
    if (quantityToSell < 0.000001) continue;

    const { totalCostEur } = consumeFifo(st.lots, quantityToSell);
    const grossEur = quantityToSell * priceEur;
    const commissionEur = grossEur * options.commissionRate;
    const netEur = grossEur - commissionEur;
    const gainEur = netEur - totalCostEur;
    const taxEur = calcTax(Math.max(0, gainEur), options);
    const eurcEur = Math.max(0, netEur - taxEur);

    st.balance -= quantityToSell;
    st.totalSold += quantityToSell;
    st.lastSalePriceEur = priceEur;
    st.avgCostEur = calcAvgCost(st.lots);
    rule.triggeredAt = date;

    state.eurcFree += eurcEur;
    state.eurcFiscalReserve += taxEur;
    state.monthSalesEur += grossEur;
    state.monthCommissionsEur += commissionEur;
    state.monthTaxEur += taxEur;

    state.events.push({
      date,
      type: "sale",
      assetId,
      amountEur: grossEur,
      quantity: quantityToSell,
      priceEur,
      gainEur,
      taxEur,
      description: `Venta parcial ${(sellPct * 100).toFixed(0)}% ${assetId} por regla (×${rule.triggerValue})`,
    });
  }

  // Default sale proposals when no explicit rules (full_strategy)
  const assetIds = Object.keys(state.assetStates);
  for (const assetId of assetIds) {
    const st = state.assetStates[assetId];
    if (!st || st.balance <= 0 || st.failed || st.deteriorated) continue;

    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;

    const avgCost = st.avgCostEur;
    if (avgCost == null || avgCost <= 0) continue;

    const gainMultiple = priceEur / avgCost;

    // Already have explicit rules? Skip proposals for this asset
    const hasRule = cycle.saleRules.some(r => r.assetId === assetId && r.status === "active");
    if (hasRule) continue;

    // Proposal: sell 10% at 3×, 15% at 5×, 20% at 10× gain over avgCost
    // Min 5% of balance must remain after sale. Rearmed on each new ATH.
    const proposals: Array<{ threshold: number; pct: number }> = [
      { threshold: 3,  pct: 0.10 },
      { threshold: 5,  pct: 0.15 },
      { threshold: 10, pct: 0.20 },
    ];

    for (const p of proposals) {
      if (gainMultiple < p.threshold) continue;

      const saleKey = `${assetId}-${p.threshold}x`;
      if (st.usedSaleProposalIds.has(saleKey)) continue;

      // Keep at least 5% of balance
      const maxSellPct = Math.min(p.pct, Math.max(0, 1 - 0.05));
      const quantityToSell = st.balance * maxSellPct;
      if (quantityToSell < 0.000001) continue;

      const { totalCostEur } = consumeFifo(st.lots, quantityToSell);
      const grossEur = quantityToSell * priceEur;
      const commissionEur = grossEur * options.commissionRate;
      const netEur = grossEur - commissionEur;
      const gainEur = netEur - totalCostEur;
      const taxEur = calcTax(Math.max(0, gainEur), options);
      const eurcEur = Math.max(0, netEur - taxEur);

      st.balance -= quantityToSell;
      st.totalSold += quantityToSell;
      st.lastSalePriceEur = priceEur;
      st.avgCostEur = calcAvgCost(st.lots);
      st.usedSaleProposalIds.add(saleKey);

      state.eurcFree += eurcEur;
      state.eurcFiscalReserve += taxEur;
      state.monthSalesEur += grossEur;
      state.monthCommissionsEur += commissionEur;
      state.monthTaxEur += taxEur;

      state.events.push({
        date,
        type: "sale",
        assetId,
        amountEur: grossEur,
        quantity: quantityToSell,
        priceEur,
        gainEur,
        taxEur,
        description: `Propuesta: venta ${(maxSellPct * 100).toFixed(0)}% ${assetId} a ×${p.threshold} coste`,
      });

      break; // one proposal at a time per asset
    }
  }
}

// ─── Formato moneda (para descripciones de eventos) ─────────────────────────

function fmtEur(v: number): string {
  return v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

// ─── Evaluación de recompras ─────────────────────────────────────────────────

function evaluateRebuys(
  cycle: SimCycle,
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
  options: SimOptions,
  date: number,
): void {
  if (state.eurcFree < 0.5) return;
  if (options.policy === "plan_base") return;

  for (const tier of cycle.rebuyTiers) {
    if (tier.status !== "active") continue;

    const assetId = tier.assetId;
    if (!assetId) continue;

    const st = state.assetStates[assetId];
    if (!st || st.failed) continue;

    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;

    const referencePrice = tier.referenceType === "last_sale"
      ? st.lastSalePriceEur
      : st.peakPriceEur;

    if (!referencePrice || referencePrice <= 0) continue;

    const drawdown = (referencePrice - priceEur) / referencePrice;
    if (drawdown < tier.drawdownPercentage / 100) continue;

    // Check this tier hasn't been used for this asset
    const tierKey = `${tier.id}-${assetId}`;
    if (st.usedRebuyTierIds.has(tierKey)) continue;

    const eurcToUse = state.eurcFree * (tier.usagePercentage / 100);
    if (eurcToUse < 0.5) continue;

    const commission = eurcToUse * options.commissionRate;
    const netEur = eurcToUse - commission;
    const quantity = netEur / priceEur;

    st.balance += quantity;
    st.totalRebuys += quantity;
    const newLot: SimLot = {
      id: nextLotId(`rebuy-${assetId}`),
      assetId,
      acquiredAt: date,
      quantity,
      remaining: quantity,
      costPerUnitEur: priceEur,
      source: "sim_rebuy",
    };
    st.lots.push(newLot);
    st.avgCostEur = calcAvgCost(st.lots);
    st.usedRebuyTierIds.add(tierKey);

    state.eurcFree -= eurcToUse;
    state.monthRebuysEur += eurcToUse;
    state.monthCommissionsEur += commission;
    state.monthEurcReinvestedEur += eurcToUse;

    state.events.push({
      date,
      type: "rebuy",
      assetId,
      amountEur: eurcToUse,
      quantity,
      priceEur,
      description: `Recompra ${assetId}: -${(tier.drawdownPercentage)}% desde referencia`,
    });
  }
}

// ─── Recompras propuestas (sin escalones configurados) ───────────────────────

function evaluateProposedRebuys(
  cycle: SimCycle,
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
  options: SimOptions,
  date: number,
  cycleAssets: SimCycleAsset[],
): void {
  if (options.policy !== "full_strategy") return;
  if (state.eurcFree < 1) return;

  const DEFAULT_TIERS = [
    { drawdown: 0.20, usePct: 0.15 },
    { drawdown: 0.35, usePct: 0.25 },
    { drawdown: 0.50, usePct: 0.40 },
  ];

  const eligibleAssets = cycleAssets.filter(ca => {
    const st = state.assetStates[ca.assetId];
    return st != null && !st.failed && !st.deteriorated;
  });

  for (const ca of eligibleAssets) {
    const st = state.assetStates[ca.assetId];
    if (!st) continue;
    const priceEur = prices[ca.assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;
    if (!st.peakPriceEur || st.peakPriceEur <= 0) continue;

    const drawdown = (st.peakPriceEur - priceEur) / st.peakPriceEur;

    for (const tier of DEFAULT_TIERS) {
      if (drawdown < tier.drawdown) continue;

      const tierKey = `proposed-rebuy-${ca.assetId}-${Math.round(tier.drawdown * 100)}-peak${Math.round(st.peakPriceEur)}`;
      if (st.usedRebuyTierIds.has(tierKey)) continue;

      const eurcToUse = state.eurcFree * tier.usePct;
      if (eurcToUse < 0.5) continue;

      const commission = eurcToUse * options.commissionRate;
      const netEur = eurcToUse - commission;
      const quantity = netEur / priceEur;

      st.balance += quantity;
      st.totalRebuys += quantity;
      const newLot: SimLot = {
        id: nextLotId(`prop-rebuy-${ca.assetId}`),
        assetId: ca.assetId,
        acquiredAt: date,
        quantity,
        remaining: quantity,
        costPerUnitEur: priceEur,
        source: "sim_rebuy",
      };
      st.lots.push(newLot);
      st.avgCostEur = calcAvgCost(st.lots);
      st.usedRebuyTierIds.add(tierKey);

      state.eurcFree -= eurcToUse;
      state.monthRebuysEur += eurcToUse;
      state.monthCommissionsEur += commission;

      state.events.push({
        date,
        type: "rebuy",
        assetId: ca.assetId,
        amountEur: eurcToUse,
        quantity,
        priceEur,
        description: `Recompra propuesta ${ca.assetId}: −${(drawdown * 100).toFixed(0)}% desde máximo (${fmtEur(eurcToUse)})`,
      });

      break; // solo el primer umbral activado por mes y activo
    }
  }
}

// ─── Reinversión residual de EURC ────────────────────────────────────────────

function reinvestResidual(
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
  options: SimOptions,
  date: number,
  activeCycleAssets: SimCycleAsset[],
): void {
  if (state.eurcFree < 0.5) return;

  // Eligible: not failed, not deteriorated, not goal-reached, has price
  const eligible = activeCycleAssets.filter(ca => {
    const st = state.assetStates[ca.assetId];
    if (!st) return false;
    if (st.goalReached || st.failed || st.deteriorated) return false;
    const price = prices[ca.assetId]?.[mKey];
    return price != null && price > 0;
  });

  if (eligible.length === 0) return;

  const budget = state.eurcFree;
  const totalAlloc = eligible.reduce((s, ca) => {
    const pct = ca.allocationType === "percentage"
      ? (ca.allocationPercentage ?? ca.allocationValue)
      : 10; // treat fixed-amount assets as 10% for reinvestment
    return s + pct;
  }, 0);

  if (totalAlloc <= 0) return;

  let spent = 0;
  for (let i = 0; i < eligible.length; i++) {
    const ca = eligible[i];
    const pct = ca.allocationType === "percentage"
      ? (ca.allocationPercentage ?? ca.allocationValue)
      : 10;
    let amountEur = i === eligible.length - 1
      ? budget - spent
      : budget * (pct / totalAlloc);
    amountEur = Math.max(0, amountEur);
    if (amountEur < 0.01) continue;

    const priceEur = prices[ca.assetId]![mKey]!;
    const commission = amountEur * options.commissionRate;
    const netEur = amountEur - commission;
    const quantity = netEur / priceEur;

    const st = state.assetStates[ca.assetId]!;
    st.balance += quantity;
    const newLot: SimLot = {
      id: nextLotId(`reinvest-${ca.assetId}`),
      assetId: ca.assetId,
      acquiredAt: date,
      quantity,
      remaining: quantity,
      costPerUnitEur: priceEur,
      source: "sim_rebuy",
    };
    st.lots.push(newLot);
    st.avgCostEur = calcAvgCost(st.lots);

    spent += amountEur;
    state.monthCommissionsEur += commission;
    state.monthEurcReinvestedEur += amountEur;
  }

  state.eurcFree = Math.max(0, state.eurcFree - spent);

  if (spent > 0.01) {
    state.events.push({
      date,
      type: "reinvestment",
      amountEur: spent,
      description: `Reinversión EURC residual: ${spent.toFixed(2)} € entre ${eligible.length} activos`,
    });
  }
}

// ─── Un mes de simulación ─────────────────────────────────────────────────────

function simulateMonth(
  state: MonthlyState,
  date: number,
  input: SimInput,
  prices: Record<string, Record<string, number>>,
  options: SimOptions,
): MonthlyState {
  const mKey = monthKey(date);

  // Clone state (shallow clone of primitives, deep clone of assetStates)
  const next: MonthlyState = {
    ...state,
    monthDate: date,
    events: [],
    monthContributionsEur: 0,
    monthSalesEur: 0,
    monthRebuysEur: 0,
    monthCommissionsEur: 0,
    monthTaxEur: 0,
    monthEurcReinvestedEur: 0,
    assetStates: {},
  };

  // Deep clone asset states
  for (const [id, s] of Object.entries(state.assetStates)) {
    next.assetStates[id] = {
      ...s,
      lots: s.lots.map(l => ({ ...l })),
      usedRebuyTierIds: new Set(s.usedRebuyTierIds),
      usedSaleProposalIds: new Set(s.usedSaleProposalIds),
    };
  }

  // Carry over accumulated EURC from previous month triggers
  // (they were already in eurcFree)

  // 1. Determine active cycle and assets
  const activeCycle = getActiveCycle(input.cycles, date);
  const cycleAssets = activeCycle ? getActiveCycleAssets(activeCycle, date) : [];

  // 2. Apply strategy revisions
  if (activeCycle) {
    for (const rev of activeCycle.revisions) {
      if (rev.effectiveDate <= date) {
        try {
          const changes = JSON.parse(rev.changesJson) as Record<string, unknown>;
          // Apply allocation changes to cycle assets in the state
          for (const [assetId, change] of Object.entries(changes)) {
            const ca = cycleAssets.find(a => a.assetId === assetId);
            if (ca && typeof change === "object" && change !== null) {
              const c = change as Record<string, unknown>;
              if (typeof c.allocationPercentage === "number") {
                ca.allocationPercentage = c.allocationPercentage;
              }
            }
          }
        } catch {
          // malformed JSON — skip
        }
      }
    }
  }

  // 3. Check substitutions
  if (activeCycle) {
    for (const sub of activeCycle.substitutions) {
      if (sub.status !== "pending" || sub.effectiveDate > date) continue;

      const fromSt = next.assetStates[sub.fromAssetId];
      if (!fromSt || fromSt.balance <= 0) { sub.status = "executed"; continue; }

      const priceFrom = prices[sub.fromAssetId]?.[mKey];
      const priceTo = prices[sub.toAssetId]?.[mKey];
      if (!priceFrom || !priceTo) continue;

      // Sell all of fromAsset
      const grossEur = fromSt.balance * priceFrom;
      const { totalCostEur } = consumeFifo(fromSt.lots, fromSt.balance);
      const commissionEur = grossEur * options.commissionRate;
      const netEur = grossEur - commissionEur;
      const gainEur = netEur - totalCostEur;
      const taxEur = calcTax(Math.max(0, gainEur), options);
      const eurcForPurchase = Math.max(0, netEur - taxEur);

      fromSt.totalSold += fromSt.balance;
      fromSt.balance = 0;
      fromSt.lots = [];
      fromSt.avgCostEur = null;

      // Buy toAsset
      if (!next.assetStates[sub.toAssetId]) {
        next.assetStates[sub.toAssetId] = {
          assetId: sub.toAssetId,
          balance: 0, lots: [], avgCostEur: null,
          peakPriceEur: null, lastSalePriceEur: null,
          totalBought: 0, totalSold: 0, totalRebuys: 0,
          goalReached: false, failed: false, deteriorated: false,
          usedRebuyTierIds: new Set(),
          usedSaleProposalIds: new Set(),
        };
      }
      const toSt = next.assetStates[sub.toAssetId];
      const commTo = eurcForPurchase * options.commissionRate;
      const netToBuy = eurcForPurchase - commTo;
      const qtyTo = netToBuy / priceTo;
      toSt.balance += qtyTo;
      toSt.lots.push({
        id: nextLotId(`sub-${sub.toAssetId}`),
        assetId: sub.toAssetId,
        acquiredAt: date,
        quantity: qtyTo,
        remaining: qtyTo,
        costPerUnitEur: priceTo,
        source: "sim_plan",
      });
      toSt.avgCostEur = calcAvgCost(toSt.lots);

      next.eurcFiscalReserve += taxEur;
      next.monthSalesEur += grossEur;
      next.monthCommissionsEur += commissionEur + commTo;
      next.monthTaxEur += taxEur;

      sub.status = "executed";

      next.events.push({
        date, type: "substitution",
        assetId: sub.fromAssetId,
        amountEur: grossEur,
        description: `Sustitución: ${sub.fromAssetId} → ${sub.toAssetId}`,
      });
    }
  }

  // 4. Update peak prices and detect failures
  for (const [assetId, st] of Object.entries(next.assetStates)) {
    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;
    if (st.peakPriceEur == null || priceEur > st.peakPriceEur) {
      // Nueva ATH: limpiar escalones propuestos del pico anterior para rearme
      if (st.peakPriceEur != null) {
        const rebuyPrefix = `proposed-rebuy-${assetId}-`;
        for (const key of [...st.usedRebuyTierIds]) {
          if (key.startsWith(rebuyPrefix)) st.usedRebuyTierIds.delete(key);
        }
        // Rearmar propuestas de venta: nuevo ciclo puede vender de nuevo
        st.usedSaleProposalIds.clear();
      }
      st.peakPriceEur = priceEur;
    }
    if (st.peakPriceEur != null && st.peakPriceEur > 0) {
      const drawdownFromPeak = (st.peakPriceEur - priceEur) / st.peakPriceEur;
      if (!st.failed && drawdownFromPeak > 0.97) {
        st.failed = true;
        // Write off the position
        const lostValue = st.balance * priceEur;
        st.balance = 0;
        st.lots = [];
        st.avgCostEur = null;
        next.events.push({
          date, type: "asset_failed",
          assetId, amountEur: lostValue,
          description: `${assetId}: activo fallido (−${(drawdownFromPeak * 100).toFixed(0)}% desde máximo)`,
        });
      } else if (!st.deteriorated && drawdownFromPeak > 0.85) {
        st.deteriorated = true;
        next.events.push({
          date, type: "asset_deteriorated",
          assetId,
          description: `${assetId}: deterioro severo (−${(drawdownFromPeak * 100).toFixed(0)}% desde máximo), suspendidas compras`,
        });
      }
    }
  }

  // 5. Evaluate sales (partial, before adding new capital)
  if (activeCycle) {
    evaluateSales(activeCycle, next, prices, mKey, options, date);
  }

  // 6. Add monthly contribution
  if (activeCycle && activeCycle.startDate <= date && (activeCycle.endDate == null || activeCycle.endDate > date)) {
    const budget = activeCycle.monthlyAmountEur;
    const allocations = distributeMonthly(activeCycle, cycleAssets, budget, next.assetStates);

    for (const alloc of allocations) {
      const priceEur = prices[alloc.assetId]?.[mKey];
      if (!priceEur || priceEur <= 0) {
        // No price — add to EURC free
        next.eurcFree += alloc.amountEur;
        continue;
      }

      const st = next.assetStates[alloc.assetId];
      if (!st) continue;

      // Check goal
      let goalReached = false;
      const ca = cycleAssets.find(a => a.assetId === alloc.assetId);
      if (ca) {
        if (ca.targetAmount != null && st.balance >= ca.targetAmount) goalReached = true;
        if (ca.targetValueEur != null && st.balance * priceEur >= ca.targetValueEur) goalReached = true;
      }

      if (goalReached && !st.goalReached) {
        st.goalReached = true;
        next.events.push({
          date, type: "goal_reached",
          assetId: alloc.assetId,
          description: `Objetivo alcanzado para ${alloc.assetId}`,
        });
        continue;
      }
      if (st.goalReached) continue;

      const commissionEur = alloc.amountEur * options.commissionRate;
      const netEur = alloc.amountEur - commissionEur;
      const quantity = netEur / priceEur;

      st.balance += quantity;
      st.totalBought += quantity;
      const newLot: SimLot = {
        id: nextLotId(`plan-${alloc.assetId}`),
        assetId: alloc.assetId,
        acquiredAt: date,
        quantity,
        remaining: quantity,
        costPerUnitEur: priceEur,
        source: "sim_plan",
      };
      st.lots.push(newLot);
      st.avgCostEur = calcAvgCost(st.lots);

      next.monthContributionsEur += alloc.amountEur;
      next.monthCommissionsEur += commissionEur;

      next.events.push({
        date, type: "purchase",
        assetId: alloc.assetId,
        amountEur: alloc.amountEur,
        quantity,
        priceEur,
        description: `Compra mensual ${alloc.assetId}: ${alloc.amountEur.toFixed(2)} €`,
      });
    }
  }

  // 7. Evaluate rebuys (configured tiers)
  if (activeCycle) {
    evaluateRebuys(activeCycle, next, prices, mKey, options, date);
  }

  // 7b. Proposed rebuys (when no configured tiers or as supplement, full_strategy only)
  if (activeCycle && cycleAssets.length > 0) {
    evaluateProposedRebuys(activeCycle, next, prices, mKey, options, date, cycleAssets);
  }

  // 8. Reinvest residual EURC (after rebuys)
  if (activeCycle && cycleAssets.length > 0) {
    reinvestResidual(next, prices, mKey, options, date, cycleAssets);
  }

  // 9. Accumulators
  next.cumulativeContributionsEur = state.cumulativeContributionsEur + next.monthContributionsEur;
  next.cumulativeSalesEur = state.cumulativeSalesEur + next.monthSalesEur;
  next.cumulativeRebuysEur = state.cumulativeRebuysEur + next.monthRebuysEur;
  next.cumulativeTaxEur = state.cumulativeTaxEur + next.monthTaxEur;
  next.cumulativeCommissionsEur = state.cumulativeCommissionsEur + next.monthCommissionsEur;

  return next;
}

// ─── Construir snapshot anual desde estados mensuales ────────────────────────

function buildAnnualSnapshot(
  year: number,
  monthsOfYear: MonthlyState[],
  prices: Record<string, Record<string, number>>,
  lastMonthPrevYear: MonthlyState | null,
  input: SimInput,
): AnnualSnapshot {
  if (monthsOfYear.length === 0) throw new Error(`No months for year ${year}`);

  const lastMonth = monthsOfYear[monthsOfYear.length - 1];
  const mKey = monthKey(lastMonth.monthDate);
  const assetIds = Object.keys(lastMonth.assetStates);

  // Gross value of all positions
  let closingGrossEur = 0;
  const positions: Record<string, AnnualAssetPosition> = {};

  for (const assetId of assetIds) {
    const st = lastMonth.assetStates[assetId];
    const priceEur = prices[assetId]?.[mKey] ?? null;
    const valueEur = priceEur != null && st.balance > 0 ? st.balance * priceEur : null;
    if (valueEur != null) closingGrossEur += valueEur;

    const unrealizedGainEur =
      valueEur != null && st.avgCostEur != null && st.balance > 0
        ? valueEur - st.balance * st.avgCostEur
        : null;

    positions[assetId] = {
      assetId,
      balance: st.balance,
      avgCostEur: st.avgCostEur,
      priceEur,
      valueEur,
      unrealizedGainEur,
      totalBought: st.totalBought,
      totalSold: st.totalSold,
      totalRebuys: st.totalRebuys,
      goalReached: st.goalReached,
      failed: st.failed,
    };
  }

  closingGrossEur += lastMonth.eurcFree + lastMonth.eurcFiscalReserve + lastMonth.eurCash;
  // Patrimonio neto = bruto − reserva fiscal (el usuario la debe pero sigue siendo suya)
  const closingWealthEur = closingGrossEur - lastMonth.eurcFiscalReserve;

  // Opening wealth = cierre neto del año anterior (excluye reserva fiscal, igual que closingWealthEur)
  const openingWealthEur = lastMonthPrevYear != null
    ? (() => {
        const prevMKey = monthKey(lastMonthPrevYear.monthDate);
        let ow = 0;
        for (const [id, st] of Object.entries(lastMonthPrevYear.assetStates)) {
          const p = prices[id]?.[prevMKey] ?? 0;
          ow += st.balance * p;
        }
        // Excluye eurcFiscalReserve para consistencia con closingWealthEur (neto)
        ow += lastMonthPrevYear.eurcFree + lastMonthPrevYear.eurCash;
        return ow;
      })()
    : (input.currentPositions.reduce((s, p) => {
        return s + (p.balance * (p.currentPriceEur ?? 0));
      }, 0) + input.eurcFree + input.eurCash); // eurCash pero NO eurcFiscalReserve inicial

  // Aggregate year flows from all months
  const contributionsEur = monthsOfYear.reduce((s, m) => s + m.monthContributionsEur, 0);
  const salesEur = monthsOfYear.reduce((s, m) => s + m.monthSalesEur, 0);
  const rebuysEur = monthsOfYear.reduce((s, m) => s + m.monthRebuysEur, 0);
  const commissionsEur = monthsOfYear.reduce((s, m) => s + m.monthCommissionsEur, 0);
  const taxEur = monthsOfYear.reduce((s, m) => s + m.monthTaxEur, 0);
  const eurcReinvestedEur = monthsOfYear.reduce((s, m) => s + m.monthEurcReinvestedEur, 0);

  const marketGainEur = closingWealthEur - openingWealthEur - contributionsEur;

  // Modified Dietz: time-adjusts contributions to avoid inflating return
  // Assumes contributions arrive mid-year on average (weight 0.5)
  const modDietzDenom = openingWealthEur + contributionsEur * 0.5;
  const annualReturnPct = modDietzDenom > 0
    ? (marketGainEur / modDietzDenom) * 100
    : null;

  // Determine scope: plan or extrapol
  const lastCycleEnd = input.cycles.reduce<number | null>((max, c) => {
    if (c.endDate == null) return null; // no end = still in plan
    if (max == null) return c.endDate;
    return Math.max(max, c.endDate);
  }, 0);
  const scope: "plan" | "extrapol" =
    lastCycleEnd == null || new Date(lastMonth.monthDate).getFullYear() <= new Date(lastCycleEnd).getFullYear()
      ? "plan"
      : "extrapol";

  // Collect all events from all months of this year
  const events = monthsOfYear.flatMap(m => m.events);

  // Skip reasons: derive from events (or lack thereof)
  const salesSkipReasons: string[] = [];
  const rebuysSkipReasons: string[] = [];

  if (salesEur === 0) {
    // Explain why no sales happened
    for (const assetId of assetIds) {
      const st = lastMonth.assetStates[assetId];
      if (!st || st.balance <= 0 || st.failed) continue;
      const priceEur = prices[assetId]?.[mKey];
      if (!priceEur) continue;
      const avgCost = st.avgCostEur;
      if (!avgCost || avgCost <= 0) continue;
      const mult = priceEur / avgCost;
      if (mult < 3) {
        salesSkipReasons.push(`${assetId}: ×${mult.toFixed(2)} coste (umbral mínimo ×3)`);
      } else {
        salesSkipReasons.push(`${assetId}: umbral ×3 superado pero escalón ya consumido`);
      }
    }
  }

  if (rebuysEur === 0) {
    for (const assetId of assetIds) {
      const st = lastMonth.assetStates[assetId];
      if (!st || st.failed) continue;
      if (!st.peakPriceEur) { rebuysSkipReasons.push(`${assetId}: sin precio máximo registrado`); continue; }
      const priceEur = prices[assetId]?.[mKey];
      if (!priceEur) continue;
      const drawdown = (st.peakPriceEur - priceEur) / st.peakPriceEur;
      if (drawdown < 0.20) {
        rebuysSkipReasons.push(`${assetId}: caída ${(drawdown * 100).toFixed(0)}% (umbral mínimo −20% desde máximo)`);
      } else {
        rebuysSkipReasons.push(`${assetId}: umbral superado pero sin EURC libre o escalón ya consumido`);
      }
    }
    if (lastMonth.eurcFree < 1) {
      rebuysSkipReasons.push("Sin EURC reinvertible disponible");
    }
  }

  return {
    year,
    scope,
    openingWealthEur,
    closingWealthEur,
    closingGrossEur,
    contributionsEur,
    marketGainEur,
    salesEur,
    rebuysEur,
    commissionsEur,
    taxEur,
    eurcReinvestedEur,
    fiscalReserveEur: lastMonth.eurcFiscalReserve,
    eurcFreeEur: lastMonth.eurcFree,
    eurCashEur: lastMonth.eurCash,
    annualReturnPct,
    positions,
    events,
    salesSkipReasons,
    rebuysSkipReasons,
  };
}

// ─── XIRR simplificado ───────────────────────────────────────────────────────

function calcXirr(
  initialInvestment: number,
  contributions: Array<{ date: number; amount: number }>,
  finalValue: number,
  finalDate: number,
): number | null {
  if (finalValue <= 0) return null;
  // Newton-Raphson XIRR
  const cashFlows = [
    { t: 0, v: -initialInvestment },
    ...contributions.map((c, i) => ({
      t: (c.date - (contributions[0]?.date ?? finalDate)) / (365.25 * 24 * 3600 * 1000),
      v: -c.amount,
    })),
    { t: (finalDate - (contributions[0]?.date ?? finalDate)) / (365.25 * 24 * 3600 * 1000), v: finalValue },
  ];

  let r = 0.10;
  for (let iter = 0; iter < 100; iter++) {
    let f = 0; let df = 0;
    for (const cf of cashFlows) {
      const factor = Math.pow(1 + r, cf.t);
      f += cf.v / factor;
      df -= cf.t * cf.v / (factor * (1 + r));
    }
    if (Math.abs(df) < 1e-10) break;
    const nr = r - f / df;
    if (Math.abs(nr - r) < 1e-7) { r = nr; break; }
    r = nr;
    if (r < -0.99) return null;
  }
  return isFinite(r) ? r : null;
}

// ─── Máximo drawdown ─────────────────────────────────────────────────────────

function calcMaxDrawdown(snapshots: AnnualSnapshot[]): number | null {
  if (snapshots.length < 2) return null;
  let peak = snapshots[0].closingWealthEur;
  let maxDD = 0;
  for (const s of snapshots) {
    if (s.closingWealthEur > peak) peak = s.closingWealthEur;
    if (peak > 0) {
      const dd = (peak - s.closingWealthEur) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

// ─── Ejecución de un escenario completo ──────────────────────────────────────

function runScenario(
  input: SimInput,
  scenario: "conservador" | "moderado" | "base" | "favorable" | "optimista",
): ScenarioResult {
  // Build price maps for all asset IDs
  const allAssetIds = [
    ...new Set([
      ...input.currentPositions.map(p => p.assetId),
      ...input.cycles.flatMap(c => c.assets.map(a => a.assetId)),
    ]),
  ].filter(id => id !== "EURC" && id !== "EUR");

  // Get current prices (from currentPositions)
  const currentPriceMap: Record<string, number> = {};
  for (const pos of input.currentPositions) {
    if (pos.currentPriceEur != null && pos.currentPriceEur > 0) {
      currentPriceMap[pos.assetId] = pos.currentPriceEur;
    }
  }

  const prices: Record<string, Record<string, number>> = {};
  for (const assetId of allAssetIds) {
    const currentPrice = currentPriceMap[assetId] ?? 1.0;
    prices[assetId] = buildPriceMap(
      assetId, currentPrice, scenario, input.now, input.horizonDate
    );
  }

  // Initialize state
  const options = input.options ?? DEFAULT_SIM_OPTIONS;
  let state = initState(input);

  // Monthly loop
  const startD = new Date(input.now);
  startD.setDate(1);
  startD.setHours(0, 0, 0, 0);
  startD.setMonth(startD.getMonth() + 1); // start from NEXT month

  const allMonthlyStates: Array<{ year: number; state: MonthlyState }> = [];

  const d = new Date(startD);
  while (d.getTime() <= input.horizonDate) {
    state = simulateMonth(state, d.getTime(), input, prices, options);
    allMonthlyStates.push({ year: d.getFullYear(), state });
    d.setMonth(d.getMonth() + 1);
  }

  // Group by year; track monthly opening wealth for TWR
  const byYear: Record<number, MonthlyState[]> = {};
  for (const { year, state: ms } of allMonthlyStates) {
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(ms);
  }

  // Patrimonio neto mensual: excluye reserva fiscal (consistente con closingWealthEur en snapshots)
  function calcWealth(ms: MonthlyState, mK: string): number {
    let w = 0;
    for (const [id, st] of Object.entries(ms.assetStates)) {
      w += st.balance * (prices[id]?.[mK] ?? 0);
    }
    return w + ms.eurcFree + ms.eurCash; // NO eurcFiscalReserve
  }

  const years = Object.keys(byYear).map(Number).sort();
  const annualSnapshots: AnnualSnapshot[] = [];
  let prevYearLastMonth: MonthlyState | null = null;

  for (const year of years) {
    const monthsOfYear = byYear[year];
    const snap = buildAnnualSnapshot(year, monthsOfYear, prices, prevYearLastMonth, input);
    annualSnapshots.push(snap);
    prevYearLastMonth = monthsOfYear[monthsOfYear.length - 1];
  }

  // Summary
  const lastSnap = annualSnapshots[annualSnapshots.length - 1];

  // Patrimonio neto inicial: excluye reserva fiscal (equivalente a openingWealthEur año 1)
  const initialWealth = input.currentPositions.reduce(
    (s, p) => s + p.balance * (p.currentPriceEur ?? 0), 0
  ) + input.eurcFree + input.eurCash; // NO input.eurcFiscalReserve

  // TWR: product of per-month sub-period returns excluding contributions
  // r_m = marketGain_m / openingWealth_m ; TWR = Π(1+r_m) - 1
  let twrProduct = 1.0;
  {
    let pw = initialWealth;
    for (const { state: ms } of allMonthlyStates) {
      const mK = monthKey(ms.monthDate);
      const closing = calcWealth(ms, mK);
      const contrib = ms.monthContributionsEur;
      const openingForReturn = pw + contrib * 0.5; // Modified Dietz sub-period
      const marketGain = closing - pw - contrib;
      const subReturn = openingForReturn > 0 ? marketGain / openingForReturn : 0;
      twrProduct *= (1 + subReturn);
      pw = closing;
    }
  }
  const twrAnnual = allMonthlyStates.length > 0
    ? Math.pow(twrProduct, 12 / allMonthlyStates.length) - 1
    : null;

  // XIRR contributions
  const contributions = annualSnapshots.map(s => ({
    date: new Date(s.year, 0, 1).getTime(),
    amount: s.contributionsEur,
  }));

  const xirr = calcXirr(
    initialWealth,
    contributions,
    lastSnap?.closingWealthEur ?? 0,
    input.horizonDate,
  );

  const maxDD = calcMaxDrawdown(annualSnapshots);

  const finalState = prevYearLastMonth;
  const assetSummaries: AssetSimSummary[] = allAssetIds.map(assetId => {
    const st = finalState?.assetStates[assetId];
    const lastMKey = finalState ? monthKey(finalState.monthDate) : "";
    const finalPrice = finalState ? (prices[assetId]?.[lastMKey] ?? null) : null;
    return {
      assetId,
      finalBalance: st?.balance ?? 0,
      finalValueEur: finalPrice != null && (st?.balance ?? 0) > 0 ? (st?.balance ?? 0) * finalPrice : null,
      totalBought: st?.totalBought ?? 0,
      totalSold: st?.totalSold ?? 0,
      totalRebuys: st?.totalRebuys ?? 0,
      goalReached: st?.goalReached ?? false,
      failed: st?.failed ?? false,
      finalAvgCostEur: st?.avgCostEur ?? null,
      finalPriceEur: finalPrice,
    };
  });

  const summary: ScenarioSummary = {
    scenario,
    initialWealthEur: initialWealth,
    finalNetWealthEur: lastSnap?.closingWealthEur ?? initialWealth,
    totalContributionsEur: annualSnapshots.reduce((s, a) => s + a.contributionsEur, 0),
    totalHistoricalCapitalEur: input.historicalCapitalEur,
    totalMarketGainEur: annualSnapshots.reduce((s, a) => s + a.marketGainEur, 0),
    totalSalesEur: annualSnapshots.reduce((s, a) => s + a.salesEur, 0),
    totalRebuysEur: annualSnapshots.reduce((s, a) => s + a.rebuysEur, 0),
    totalCommissionsEur: annualSnapshots.reduce((s, a) => s + a.commissionsEur, 0),
    totalTaxEur: annualSnapshots.reduce((s, a) => s + a.taxEur, 0),
    totalEurcReinvestedEur: annualSnapshots.reduce((s, a) => s + a.eurcReinvestedEur, 0),
    finalEurcFreeEur: lastSnap?.eurcFreeEur ?? 0,
    finalFiscalReserveEur: lastSnap?.fiscalReserveEur ?? 0,
    xirr,
    twr: twrAnnual,
    maxDrawdownPct: maxDD,
    assetSummaries,
  };

  return {
    scenario,
    label: SCENARIO_LABELS[scenario],
    annualSnapshots,
    summary,
  };
}

// ─── Corrección: adjuntar cumulatives al snapshot ────────────────────────────
// (AnnualSnapshot needs cumulativeContributionsEur — we add it from the summary)

declare module "./types" {
  interface AnnualSnapshot {
    cumulativeContributionsEur?: number;
  }
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

export function runPerspectivesSimulation(input: SimInput): PerspectivesSimulation {
  const results = SIM_SCENARIOS.map(scenario => runScenario(input, scenario));

  const startYear = results[0]?.annualSnapshots[0]?.year ?? new Date(input.now).getFullYear() + 1;
  const endYear = results[0]?.annualSnapshots.at(-1)?.year ?? startYear;

  // Validation checks
  const validations: ValidationResult[] = [];

  // V1: patrimonio final no negativo
  for (const r of results) {
    const last = r.annualSnapshots.at(-1);
    validations.push({
      rule: `${r.scenario}: patrimonio_final >= 0`,
      passed: (last?.closingWealthEur ?? 0) >= 0,
      detail: `${last?.closingWealthEur?.toFixed(0) ?? "N/A"} €`,
    });
  }

  // V2: Optimista >= Base
  const opt = results.find(r => r.scenario === "optimista")?.summary.finalNetWealthEur ?? 0;
  const base = results.find(r => r.scenario === "base")?.summary.finalNetWealthEur ?? 0;
  validations.push({
    rule: "optimista >= base",
    passed: opt >= base - 1,
    detail: `optimista=${opt.toFixed(0)}€ base=${base.toFixed(0)}€`,
  });

  // V3: Continuidad anual (closing N = opening N+1)
  for (const r of results) {
    let ok = true;
    for (let i = 0; i < r.annualSnapshots.length - 1; i++) {
      const diff = Math.abs(r.annualSnapshots[i].closingWealthEur - r.annualSnapshots[i + 1].openingWealthEur);
      if (diff > 1) { ok = false; break; }
    }
    validations.push({
      rule: `${r.scenario}: continuidad_anual`,
      passed: ok,
      detail: ok ? "OK" : "Discontinuidad detectada",
    });
  }

  return {
    computedAt: Date.now(),
    startYear,
    endYear,
    horizonDate: input.horizonDate,
    scenarios: results,
    validations,
  };
}
