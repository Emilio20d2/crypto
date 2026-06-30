// ─── Motor de simulación mensual — Perspectivas (nuevo, desde cero) ──────────
// Implementa la fórmula correcta:
//   valor futuro = cantidad_acumulada × precio_previsto
// No usa: capital × tasa_general

import type {
  SimInput, SimOptions, MonthlyState, AssetSimState, SimLot,
  AnnualSnapshot, AnnualAssetPosition, SimEvent, ScenarioResult,
  ScenarioSummary, AssetSimSummary, SimCycle, SimCycleAsset,
  SimSaleRule, SimRebuyTier, SimSubstitution, PerspectivesSimulation,
  ValidationResult, SimDiagnostics, AssetPriceInfo, ForecastDataset,
  SimulationStrategyMode, AnnualStrategyReview, MonthlyDecisionType,
} from "./types";
import { SIM_SCENARIOS, SCENARIO_LABELS, DEFAULT_SIM_OPTIONS } from "./types";
import {
  buildExternalPriceMap, monthKey, getAssetTier, CIRCULATING_SUPPLY_M,
  type CoverageState,
} from "./external-price-builder";
import {
  buildMarketRegimePricePath,
  type MarketRegime,
  type MarketRegimePath,
} from "./market-regime-engine";

const EMPTY_FORECAST_DATASET: ForecastDataset = {
  sources: [],
  candidateId: null,
  activatedAt: null,
  usdToEurRate: null,
  fxSource: null,
  fxRateAt: null,
};

function stableSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

function realizedGainFromConsumedLots(
  consumed: Array<{ lot: SimLot; qty: number; costEur: number }>,
  priceEur: number,
  commissionEur: number,
  fundingOrigin: SimLot["fundingOrigin"],
): number {
  const originGross = consumed
    .filter(item => item.lot.fundingOrigin === fundingOrigin)
    .reduce((sum, item) => sum + item.qty * priceEur, 0);
  if (originGross <= 0) return 0;
  const totalGross = consumed.reduce((sum, item) => sum + item.qty * priceEur, 0);
  const originCost = consumed
    .filter(item => item.lot.fundingOrigin === fundingOrigin)
    .reduce((sum, item) => sum + item.costEur, 0);
  const attributedCommission = totalGross > 0 ? commissionEur * (originGross / totalGross) : 0;
  return originGross - attributedCommission - originCost;
}

function calcAvgCost(lots: SimLot[]): number | null {
  const totalQty = lots.reduce((s, l) => s + l.remaining, 0);
  if (totalQty <= 0) return null;
  const totalCost = lots.reduce((s, l) => s + l.remaining * l.costPerUnitEur, 0);
  return totalCost / totalQty;
}

function makeLot(input: {
  id: string;
  assetId: string;
  acquiredAt: number;
  quantity: number;
  costPerUnitEur: number;
  source: SimLot["source"];
  fundingOrigin: SimLot["fundingOrigin"];
  sourceEurcBucketId?: string | null;
  profitHarvestCycleId?: string | null;
  purchaseValueEur?: number;
  acquisitionCostsEur?: number;
}): SimLot {
  const purchaseValueEur = input.purchaseValueEur ?? input.quantity * input.costPerUnitEur;
  const acquisitionCostsEur = input.acquisitionCostsEur ?? 0;
  return {
    id: input.id,
    assetId: input.assetId,
    acquiredAt: input.acquiredAt,
    quantity: input.quantity,
    remaining: input.quantity,
    costPerUnitEur: input.costPerUnitEur,
    source: input.source,
    fundingOrigin: input.fundingOrigin,
    sourceEurcBucketId: input.sourceEurcBucketId ?? null,
    profitHarvestCycleId: input.profitHarvestCycleId ?? null,
    purchaseDate: input.acquiredAt,
    purchasePriceEur: input.costPerUnitEur,
    purchaseValueEur,
    acquisitionCostsEur,
    units: input.quantity,
    openUnits: input.quantity,
    costBasisEur: purchaseValueEur + acquisitionCostsEur,
  };
}

interface InternalRebuyMetrics {
  principalEur: number;
  openCostBasisEur: number;
  currentMarketValueEur: number;
  unrealizedGainEur: number;
  realizedGainEur: number;
  totalReturnEur: number;
  totalReturnPct: number | null;
  unitsOpen: number;
  unitsSold: number;
}

function calcInternalRebuyMetrics(
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
): InternalRebuyMetrics {
  let principalEur = 0;
  let openCostBasisEur = 0;
  let currentMarketValueEur = 0;
  let unitsOpen = 0;
  let unitsSold = 0;
  for (const [assetId, st] of Object.entries(state.assetStates)) {
    const price = prices[assetId]?.[mKey] ?? null;
    for (const lot of st.lots) {
      if (lot.fundingOrigin !== "INTERNAL_REBUY") continue;
      principalEur += lot.purchaseValueEur + lot.acquisitionCostsEur;
      unitsOpen += lot.remaining;
      unitsSold += Math.max(0, lot.quantity - lot.remaining);
      const openRatio = lot.quantity > 0 ? lot.remaining / lot.quantity : 0;
      openCostBasisEur += lot.remaining * lot.costPerUnitEur + lot.acquisitionCostsEur * openRatio;
      if (price != null && price > 0) {
        currentMarketValueEur += lot.remaining * price;
      }
    }
  }
  const unrealizedGainEur = currentMarketValueEur - openCostBasisEur;
  const realizedGainEur = state.cumulativeInternalRebuyRealizedGainEur;
  const totalReturnEur = realizedGainEur + unrealizedGainEur;
  return {
    principalEur,
    openCostBasisEur,
    currentMarketValueEur,
    unrealizedGainEur,
    realizedGainEur,
    totalReturnEur,
    totalReturnPct: principalEur > 0 ? totalReturnEur / principalEur : null,
    unitsOpen,
    unitsSold,
  };
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

function calcOpenCostBasis(state: MonthlyState): number {
  let cost = 0;
  for (const st of Object.values(state.assetStates)) {
    for (const lot of st.lots) {
      cost += lot.remaining * lot.costPerUnitEur;
    }
  }
  return cost;
}

function calcInvestedCapital(
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  mKey: string,
): number {
  let invested = 0;
  for (const [assetId, st] of Object.entries(state.assetStates)) {
    if (st.balance <= 0) continue;
    const price = prices[assetId]?.[mKey];
    if (price != null && price > 0) invested += st.balance * price;
  }
  return invested;
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
      .map(l => makeLot({
        id: l.id,
        assetId: l.assetId,
        acquiredAt: l.date,
        quantity: l.remainingAmount,
        costPerUnitEur: l.unitAcquisitionPriceEur,
        source: "historical" as const,
        fundingOrigin: "INITIAL_POSITION",
      }))
      .sort((a, b) => a.acquiredAt - b.acquiredAt);

    // If no lots but has balance, create synthetic lot from avgCost
    if (historicalLots.length === 0 && pos.balance > 0 && pos.avgCostEur != null) {
      historicalLots.push(makeLot({
        id: `synthetic-${pos.assetId}`,
        assetId: pos.assetId,
        acquiredAt: Date.now() - 365 * 24 * 3600 * 1000,
        quantity: pos.balance,
        costPerUnitEur: pos.avgCostEur,
        source: "historical",
        fundingOrigin: "INITIAL_POSITION",
      }));
    }

    const avgCostFromLots = calcAvgCost(historicalLots);

    assetStates[pos.assetId] = {
      assetId: pos.assetId,
      balance: pos.balance,
      lots: historicalLots,
      avgCostEur: pos.avgCostEur ?? avgCostFromLots,
      peakPriceEur: pos.currentPriceEur ?? null,
      lastSalePriceEur: null,
      lastSaleDate: null,
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
          lastSaleDate: null,
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

  const latestSalesByAsset = new Map<string, { date: number; unitPriceEur: number; quantity: number }>();
  for (const sale of input.historicalSales ?? []) {
    if (!sale.assetId || sale.quantity <= 0 || sale.unitPriceEur <= 0) continue;
    const prev = latestSalesByAsset.get(sale.assetId);
    if (!prev || sale.date > prev.date) {
      latestSalesByAsset.set(sale.assetId, {
        date: sale.date,
        unitPriceEur: sale.unitPriceEur,
        quantity: sale.quantity,
      });
    }
  }
  for (const [assetId, sale] of latestSalesByAsset) {
    if (!assetStates[assetId]) {
      assetStates[assetId] = {
        assetId,
        balance: 0,
        lots: [],
        avgCostEur: null,
        peakPriceEur: null,
        lastSalePriceEur: sale.unitPriceEur,
        lastSaleDate: sale.date,
        totalBought: 0,
        totalSold: sale.quantity,
        totalRebuys: 0,
        goalReached: false,
        failed: false,
        deteriorated: false,
        usedRebuyTierIds: new Set(),
        usedSaleProposalIds: new Set(),
      };
      continue;
    }
    assetStates[assetId].lastSalePriceEur = sale.unitPriceEur;
    assetStates[assetId].lastSaleDate = sale.date;
    assetStates[assetId].totalSold += sale.quantity;
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
    monthRealizedGainEur: 0,
    monthEurcReinvestedEur: 0,
    monthNetEurcInflowEur: 0,
    monthExternalPurchasesEur: 0,
    monthReinvestedCapitalEur: 0,
    monthDeployedCapitalEur: 0,
    monthInternalRebuyPrincipalEur: 0,
    monthInternalRebuyRealizedGainEur: 0,
    cumulativeContributionsEur: 0,
    cumulativeSalesEur: 0,
    cumulativeRebuysEur: 0,
    cumulativeExternalPurchasesEur: 0,
    cumulativeReinvestedCapitalEur: 0,
    cumulativeDeployedCapitalEur: 0,
    cumulativeInternalRebuyPrincipalEur: 0,
    cumulativeInternalRebuyRealizedGainEur: 0,
    cumulativeTaxEur: 0,
    cumulativeRealizedGainEur: 0,
    cumulativeCommissionsEur: 0,
  };
}

// ─── Obtener el ciclo activo para una fecha ───────────────────────────────────

// Normaliza un timestamp al inicio del día en hora local para evitar que
// diferencias de zona horaria (CET/CEST vs UTC) rompan los límites de ciclo.
function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getActiveCycle(cycles: SimCycle[], date: number): SimCycle | null {
  const dayMs = localDayStart(date);
  const active = cycles.filter(c => {
    const start = localDayStart(c.startDate);
    const end   = c.endDate != null ? localDayStart(c.endDate) : null;
    return start <= dayMs && (end == null || end > dayMs);
  });
  if (active.length === 0) return null;
  // When multiple cycles overlap, pick the one with the latest startDate.
  return active.reduce((best, c) => c.startDate > best.startDate ? c : best);
}

function getActiveCycleAssets(cycle: SimCycle, date: number): SimCycleAsset[] {
  const dayMs = localDayStart(date);
  return cycle.assets.filter(a => {
    const start = localDayStart(a.startDate);
    const end   = a.endDate != null ? localDayStart(a.endDate) : null;
    return start <= dayMs && (end == null || end > dayMs) &&
      (a.status === "active" || a.status === "goal_reached");
  });
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
    } else if (rule.triggerType === "gain_percentage") {
      triggered = ((priceEur - avgCost) / avgCost) * 100 >= rule.triggerValue;
    } else if (rule.triggerType === "price_target") {
      triggered = priceEur >= rule.triggerValue;
    }

    if (!triggered) continue;
    if (rule.triggeredAt != null) continue; // already triggered once, skip

    const sellPct = Math.min(rule.sellPercentage, 99) / 100;
    const quantityToSell = st.balance * sellPct;
    if (quantityToSell < 0.000001) continue;

    const { consumed, totalCostEur } = consumeFifo(st.lots, quantityToSell);
    const grossEur = quantityToSell * priceEur;
    const commissionEur = grossEur * options.commissionRate;
    const netEur = grossEur - commissionEur;
    const gainEur = netEur - totalCostEur;
    const internalRebuyGainEur = realizedGainFromConsumedLots(consumed, priceEur, commissionEur, "INTERNAL_REBUY");
    const taxEur = calcTax(Math.max(0, gainEur), options);
    const eurcEur = Math.max(0, netEur - taxEur);

    st.balance -= quantityToSell;
    st.totalSold += quantityToSell;
    st.lastSalePriceEur = priceEur;
    st.lastSaleDate = date;
    st.avgCostEur = calcAvgCost(st.lots);
    rule.triggeredAt = date;

    state.eurcFree += eurcEur;
    state.eurcFiscalReserve += taxEur;
    state.monthSalesEur += grossEur;
    state.monthCommissionsEur += commissionEur;
    state.monthTaxEur += taxEur;
    state.monthRealizedGainEur += gainEur;
    state.monthInternalRebuyRealizedGainEur += internalRebuyGainEur;
    state.monthNetEurcInflowEur += eurcEur;

    state.events.push({
      date,
      type: "sale",
      origin: "USER_RULE",
      assetId,
      amountEur: grossEur,
      quantity: quantityToSell,
      priceEur,
      gainEur,
      taxEur,
      description: `Venta parcial ${(sellPct * 100).toFixed(0)}% ${assetId} por regla (×${rule.triggerValue})`,
    });
  }
  // Solo se ejecutan reglas configuradas por el usuario. Sin escalones genéricos.
}

// ─── Formato moneda (para descripciones de eventos) ─────────────────────────

function fmtEur(v: number): string {
  return v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function resolveStrategyMode(options: SimOptions): SimulationStrategyMode {
  if (options.strategyMode) return options.strategyMode;
  return options.policy === "plan_base" ? "PASSIVE" : "INTELLIGENT_STRATEGY";
}

function strategySource(mode: SimulationStrategyMode): ScenarioSummary["strategySource"] {
  if (mode === "PASSIVE") return "none";
  if (mode === "USER_RULES") return "user_rules";
  if (mode === "HYBRID") return "hybrid";
  return "intelligent_engine";
}

// ─── Ventas hipotéticas de escenario ─────────────────────────────────────────

function evaluateProposedSales(
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  marketRegimes: Record<string, Record<string, MarketRegime>>,
  mKey: string,
  options: SimOptions,
  date: number,
): void {
  const mode = resolveStrategyMode(options);
  if (mode !== "INTELLIGENT_STRATEGY" && mode !== "HYBRID") return;

  const saleRegimes = new Set<MarketRegime>(["BULL_EXPANSION", "EUPHORIA", "DISTRIBUTION", "CORRECTION"]);

  for (const [assetId, st] of Object.entries(state.assetStates)) {
    if (st.failed || st.balance <= 0) continue;
    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;
    const avgCost = st.avgCostEur;
    if (avgCost == null || avgCost <= 0) continue;
    const regime = marketRegimes[assetId]?.[mKey] ?? "INSUFFICIENT_DATA";
    if (!saleRegimes.has(regime)) continue;

    const gainPct = ((priceEur - avgCost) / avgCost) * 100;
    const drawdownFromPeak = st.peakPriceEur && st.peakPriceEur > priceEur
      ? (st.peakPriceEur - priceEur) / st.peakPriceEur
      : 0;
    const regimeScore =
      regime === "EUPHORIA" ? 45 :
      regime === "DISTRIBUTION" ? 55 :
      regime === "CORRECTION" ? 35 :
      regime === "BULL_EXPANSION" ? 18 : 0;
    const drawdownScore = Math.min(25, drawdownFromPeak * 100);
    const gainScore = Math.min(55, Math.max(0, gainPct) / 4);
    const sellOpportunityScore = Math.round(regimeScore + drawdownScore + gainScore);
    if (gainPct < 60 || sellOpportunityScore < 55) continue;

    const sellPct =
      sellOpportunityScore >= 115 ? 0.25 :
      sellOpportunityScore >= 95 ? 0.20 :
      sellOpportunityScore >= 75 ? 0.15 :
      0.10;
    const saleKey = `proposed-sale-${assetId}-${regime}-${Math.floor(sellOpportunityScore / 10) * 10}`;
    if (st.usedSaleProposalIds.has(saleKey)) continue;

      const quantityToSell = st.balance * sellPct;
      const remainingAfterSale = st.balance - quantityToSell;
      if (quantityToSell < 0.000001 || remainingAfterSale <= 0) continue;

      const { consumed, totalCostEur } = consumeFifo(st.lots, quantityToSell);
      const grossEur = quantityToSell * priceEur;
      const commissionEur = grossEur * options.commissionRate;
      const netEur = grossEur - commissionEur;
      const gainEur = netEur - totalCostEur;
      const internalRebuyGainEur = realizedGainFromConsumedLots(consumed, priceEur, commissionEur, "INTERNAL_REBUY");
      const taxEur = calcTax(Math.max(0, gainEur), options);
      const eurcEur = Math.max(0, netEur - taxEur);

      st.balance = remainingAfterSale;
      st.totalSold += quantityToSell;
      st.lastSalePriceEur = priceEur;
      st.lastSaleDate = date;
      st.avgCostEur = calcAvgCost(st.lots);
      st.usedSaleProposalIds.add(saleKey);

      state.eurcFree += eurcEur;
      state.eurcFiscalReserve += taxEur;
      state.monthSalesEur += grossEur;
      state.monthCommissionsEur += commissionEur;
      state.monthTaxEur += taxEur;
      state.monthRealizedGainEur += gainEur;
      state.monthInternalRebuyRealizedGainEur += internalRebuyGainEur;
      state.monthNetEurcInflowEur += eurcEur;

      state.events.push({
        date,
        type: "sale",
        origin: "INTELLIGENT_STRATEGY",
        assetId,
        amountEur: grossEur,
        quantity: quantityToSell,
        priceEur,
        gainEur,
        taxEur,
        description: `Venta parcial hipotética ${assetId}: régimen ${regime}, score ${sellOpportunityScore}, ${(sellPct * 100).toFixed(0)}% vendido; reserva fiscal ${fmtEur(taxEur)}, EURC libre ${fmtEur(eurcEur)}`,
      });

      continue;
  }
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
  const mode = resolveStrategyMode(options);
  if (mode === "PASSIVE") return;

  for (const tier of cycle.rebuyTiers) {
    if (tier.status !== "active") continue;

    const assetId = tier.assetId;
    if (!assetId) continue;

    const st = state.assetStates[assetId];
    if (!st || st.failed) continue;

    const priceEur = prices[assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;

    const configuredReference = tier.referenceValue != null && tier.referenceValue > 0
      ? tier.referenceValue
      : null;
    const referencePrice = configuredReference
      ?? (tier.referenceType === "last_sale" ? st.lastSalePriceEur : st.peakPriceEur);

    if (!referencePrice || referencePrice <= 0) continue;
    if (tier.referenceType === "last_sale" && !configuredReference && !st.lastSaleDate) continue;

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
    const newLot = makeLot({
      id: nextLotId(`rebuy-${assetId}`),
      assetId,
      acquiredAt: date,
      quantity,
      costPerUnitEur: priceEur,
      source: "sim_rebuy",
      fundingOrigin: "INTERNAL_REBUY",
      sourceEurcBucketId: `eurc:${cycle.id}:${tier.id}:${assetId}`,
      profitHarvestCycleId: cycle.id,
      purchaseValueEur: netEur,
      acquisitionCostsEur: commission,
    });
    st.lots.push(newLot);
    st.avgCostEur = calcAvgCost(st.lots);
    st.usedRebuyTierIds.add(tierKey);

    state.eurcFree -= eurcToUse;
    state.monthRebuysEur += eurcToUse;
    state.monthCommissionsEur += commission;
    state.monthEurcReinvestedEur += eurcToUse;
    state.monthReinvestedCapitalEur += eurcToUse;
    state.monthDeployedCapitalEur += eurcToUse;
    state.monthInternalRebuyPrincipalEur += eurcToUse;

    state.events.push({
      date,
      type: "rebuy",
      origin: "USER_RULE",
      assetId,
      amountEur: eurcToUse,
      quantity,
      priceEur,
      eurcUsedEur: eurcToUse,
      commissionEur: commission,
      spreadEur: 0,
      slippageEur: 0,
      costBasisEur: eurcToUse,
      eurcOrigin: "operating_liquidity",
      relatedSaleCycleId: cycle.id,
      description: `Recompra ${assetId}: -${(tier.drawdownPercentage)}% desde referencia`,
    });
  }
}

// ─── Recompras hipotéticas con EURC libre generado por ventas ────────────────

function evaluateProposedRebuys(
  cycle: SimCycle,
  state: MonthlyState,
  prices: Record<string, Record<string, number>>,
  marketRegimes: Record<string, Record<string, MarketRegime>>,
  mKey: string,
  options: SimOptions,
  date: number,
  cycleAssets: SimCycleAsset[],
): void {
  const mode = resolveStrategyMode(options);
  if (mode !== "INTELLIGENT_STRATEGY" && mode !== "HYBRID") return;
  if (state.eurcFree < 1) return;

  const stabilizationRegimes = new Set<MarketRegime>(["CAPITULATION", "ACCUMULATION", "EARLY_RECOVERY"]);

  const eligibleAssets = cycleAssets.filter(ca => {
    const st = state.assetStates[ca.assetId];
    return st != null && !st.failed && !st.deteriorated;
  });

  for (const ca of eligibleAssets) {
    const st = state.assetStates[ca.assetId];
    if (!st) continue;
    const priceEur = prices[ca.assetId]?.[mKey];
    if (!priceEur || priceEur <= 0) continue;
    if (!st.lastSalePriceEur || st.lastSalePriceEur <= 0 || !st.lastSaleDate) continue;
    const regime = marketRegimes[ca.assetId]?.[mKey] ?? "INSUFFICIENT_DATA";
    if (!stabilizationRegimes.has(regime)) continue;

    const drawdown = (st.lastSalePriceEur - priceEur) / st.lastSalePriceEur;
    if (drawdown < 0.18) continue;

    const regimeScore = regime === "CAPITULATION" ? 48 : regime === "ACCUMULATION" ? 38 : 30;
    const drawdownScore = Math.min(45, drawdown * 100);
    const rebuyOpportunityScore = Math.round(regimeScore + drawdownScore);
    if (rebuyOpportunityScore < 56) continue;

      const tierKey = `proposed-rebuy-${ca.assetId}-${regime}-${Math.floor(rebuyOpportunityScore / 10) * 10}-sale${Math.round(st.lastSalePriceEur)}`;
      if (st.usedRebuyTierIds.has(tierKey)) continue;

      const eurcToUse = state.eurcFree;
      if (eurcToUse < 0.5) continue;

      const commission = eurcToUse * options.commissionRate;
      const netEur = eurcToUse - commission;
      const quantity = netEur / priceEur;

      st.balance += quantity;
      st.totalRebuys += quantity;
      const newLot = makeLot({
        id: nextLotId(`prop-rebuy-${ca.assetId}`),
        assetId: ca.assetId,
        acquiredAt: date,
        quantity,
        costPerUnitEur: priceEur,
        source: "sim_rebuy",
        fundingOrigin: "INTERNAL_REBUY",
        sourceEurcBucketId: `eurc:${cycle.id}:${tierKey}`,
        profitHarvestCycleId: cycle.id,
        purchaseValueEur: netEur,
        acquisitionCostsEur: commission,
      });
      st.lots.push(newLot);
      st.avgCostEur = calcAvgCost(st.lots);
      st.usedRebuyTierIds.add(tierKey);

      state.eurcFree -= eurcToUse;
      state.monthRebuysEur += eurcToUse;
      state.monthCommissionsEur += commission;
      state.monthEurcReinvestedEur += eurcToUse;
      state.monthReinvestedCapitalEur += eurcToUse;
      state.monthDeployedCapitalEur += eurcToUse;
      state.monthInternalRebuyPrincipalEur += eurcToUse;

      state.events.push({
        date,
        type: "rebuy",
        origin: "INTELLIGENT_STRATEGY",
        assetId: ca.assetId,
        amountEur: eurcToUse,
        quantity,
        priceEur,
        eurcUsedEur: eurcToUse,
        commissionEur: commission,
        spreadEur: 0,
        slippageEur: 0,
        costBasisEur: eurcToUse,
        eurcOrigin: "operating_liquidity",
        relatedSaleCycleId: cycle.id,
        description: `Recompra hipotética ${ca.assetId}: régimen ${regime}, score ${rebuyOpportunityScore}, −${(drawdown * 100).toFixed(0)}% desde venta previa; usa ${fmtEur(eurcToUse)} de EURC libre`,
      });

      break; // solo el primer umbral activado por mes y activo
  }
}

// ─── Cálculo de patrimonio neto mensual ──────────────────────────────────────
// Excluye reserva fiscal para consistencia con closingWealthEur

function calcMonthlyWealth(
  ms: MonthlyState,
  prices: Record<string, Record<string, number>>,
): number {
  const mK = monthKey(ms.monthDate);
  let w = 0;
  for (const [id, st] of Object.entries(ms.assetStates)) {
    w += st.balance * (prices[id]?.[mK] ?? 0);
  }
  return w + ms.eurcFree + ms.eurCash;
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
  // No reinvertir en el mismo mes en que hubo ventas: el EURC queda en reserva
  // para posibles recompras en correcciones futuras (evita wash-sale inmediato).
  if (state.monthSalesEur > 0) return;

  // Eligible: not failed, not deteriorated, not goal-reached, has price
  const eligible = activeCycleAssets.filter(ca => {
    const st = state.assetStates[ca.assetId];
    if (!st) return false;
    if (st.goalReached || st.failed || st.deteriorated) return false;
    const price = prices[ca.assetId]?.[mKey];
    return price != null && price > 0;
  });

  if (eligible.length === 0) return;

  // Reinversión progresiva: máximo 20% del EURC disponible por mes,
  // para que el EURC acumulado siga disponible para recompras en correcciones.
  const budget = state.eurcFree * 0.20;
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
    const newLot = makeLot({
      id: nextLotId(`reinvest-${ca.assetId}`),
      assetId: ca.assetId,
      acquiredAt: date,
      quantity,
      costPerUnitEur: priceEur,
      source: "sim_rebuy",
      fundingOrigin: "INTERNAL_REALLOCATION",
      sourceEurcBucketId: `eurc:residual:${date}`,
      profitHarvestCycleId: null,
      purchaseValueEur: netEur,
      acquisitionCostsEur: commission,
    });
    st.lots.push(newLot);
    st.avgCostEur = calcAvgCost(st.lots);

    spent += amountEur;
    state.monthCommissionsEur += commission;
    state.monthEurcReinvestedEur += amountEur;
    state.monthReinvestedCapitalEur += amountEur;
    state.monthDeployedCapitalEur += amountEur;
  }

  state.eurcFree = Math.max(0, state.eurcFree - spent);

  if (spent > 0.01) {
    state.events.push({
      date,
      type: "reinvestment",
      origin: "INTERNAL_REALLOCATION",
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
  marketRegimes: Record<string, Record<string, MarketRegime>>,
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
    monthRealizedGainEur: 0,
    monthEurcReinvestedEur: 0,
    monthNetEurcInflowEur: 0,
    monthExternalPurchasesEur: 0,
    monthReinvestedCapitalEur: 0,
    monthDeployedCapitalEur: 0,
    monthInternalRebuyPrincipalEur: 0,
    monthInternalRebuyRealizedGainEur: 0,
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
      const { consumed, totalCostEur } = consumeFifo(fromSt.lots, fromSt.balance);
      const commissionEur = grossEur * options.commissionRate;
      const netEur = grossEur - commissionEur;
      const gainEur = netEur - totalCostEur;
      const internalRebuyGainEur = realizedGainFromConsumedLots(consumed, priceFrom, commissionEur, "INTERNAL_REBUY");
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
          lastSaleDate: null,
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
      toSt.lots.push(makeLot({
        id: nextLotId(`sub-${sub.toAssetId}`),
        assetId: sub.toAssetId,
        acquiredAt: date,
        quantity: qtyTo,
        costPerUnitEur: priceTo,
        source: "sim_plan",
        fundingOrigin: "INTERNAL_REALLOCATION",
        sourceEurcBucketId: `eurc:substitution:${sub.id}`,
        profitHarvestCycleId: activeCycle.id,
        purchaseValueEur: netToBuy,
        acquisitionCostsEur: commTo,
      }));
      toSt.avgCostEur = calcAvgCost(toSt.lots);

      next.eurcFiscalReserve += taxEur;
      next.monthSalesEur += grossEur;
      next.monthCommissionsEur += commissionEur + commTo;
      next.monthTaxEur += taxEur;
      next.monthRealizedGainEur += gainEur;
      next.monthInternalRebuyRealizedGainEur += internalRebuyGainEur;
      next.monthReinvestedCapitalEur += eurcForPurchase;
      next.monthDeployedCapitalEur += eurcForPurchase;

      sub.status = "executed";

      next.events.push({
        date, type: "substitution",
        origin: "INTERNAL_REALLOCATION",
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
      // Nueva ATH: limpiar escalones propuestos del pico anterior para rearme de recompras
      if (st.peakPriceEur != null) {
        const rebuyPrefix = `proposed-rebuy-${assetId}-`;
        for (const key of [...st.usedRebuyTierIds]) {
          if (key.startsWith(rebuyPrefix)) st.usedRebuyTierIds.delete(key);
        }
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
          origin: "SYSTEM",
          assetId, amountEur: lostValue,
          description: `${assetId}: activo fallido (−${(drawdownFromPeak * 100).toFixed(0)}% desde máximo)`,
        });
      } else if (!st.deteriorated && drawdownFromPeak > 0.85) {
        st.deteriorated = true;
        next.events.push({
          date, type: "asset_deteriorated",
          origin: "SYSTEM",
          assetId,
          description: `${assetId}: deterioro severo (−${(drawdownFromPeak * 100).toFixed(0)}% desde máximo), suspendidas compras`,
        });
      }
    }
  }

  // 5. Evaluate sales (partial, before adding new capital)
  const strategyMode = resolveStrategyMode(options);
  if (activeCycle) {
    evaluateSales(activeCycle, next, prices, mKey, options, date);
  }
  if (strategyMode === "INTELLIGENT_STRATEGY" || strategyMode === "HYBRID") {
    evaluateProposedSales(next, prices, marketRegimes, mKey, options, date);
  }

  // 6. Add monthly contribution
  const _dayMs = localDayStart(date);
  if (activeCycle && localDayStart(activeCycle.startDate) <= _dayMs && (activeCycle.endDate == null || localDayStart(activeCycle.endDate) > _dayMs)) {
    const budget = activeCycle.monthlyAmountEur;
    const allocations = distributeMonthly(activeCycle, cycleAssets, budget, next.assetStates);
    const allocatedBudget = allocations.reduce((sum, alloc) => sum + alloc.amountEur, 0);
    const unallocatedBudget = Math.max(0, budget - allocatedBudget);

    if (budget > 0) {
      next.monthContributionsEur += budget;
      next.events.push({
        date,
        type: "contribution",
        origin: "PLAN_PURCHASE",
        amountEur: budget,
        description: `Aportación mensual: ${budget.toFixed(2)} €`,
      });
    }
    if (unallocatedBudget >= 0.01) {
      next.eurCash += unallocatedBudget;
    }

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
          origin: "SYSTEM",
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
      const newLot = makeLot({
        id: nextLotId(`plan-${alloc.assetId}`),
        assetId: alloc.assetId,
        acquiredAt: date,
        quantity,
        costPerUnitEur: priceEur,
        source: "sim_plan",
        fundingOrigin: "EXTERNAL_CONTRIBUTION",
        purchaseValueEur: netEur,
        acquisitionCostsEur: commissionEur,
      });
      st.lots.push(newLot);
      st.avgCostEur = calcAvgCost(st.lots);

      next.monthCommissionsEur += commissionEur;
      next.monthExternalPurchasesEur += alloc.amountEur;
      next.monthDeployedCapitalEur += alloc.amountEur;

      next.events.push({
        date, type: "purchase",
        origin: "PLAN_PURCHASE",
        assetId: alloc.assetId,
        amountEur: alloc.amountEur,
        quantity,
        priceEur,
        description: `Compra mensual ${alloc.assetId}: ${alloc.amountEur.toFixed(2)} €`,
      });
    }
  }

  // 7. Evaluate rebuys (configured tiers only — no generic tiers)
  if (activeCycle) {
    evaluateRebuys(activeCycle, next, prices, mKey, options, date);
    if (strategyMode === "INTELLIGENT_STRATEGY" || strategyMode === "HYBRID") {
      evaluateProposedRebuys(activeCycle, next, prices, marketRegimes, mKey, options, date, cycleAssets);
    }
  }

  // 8. Accumulators
  next.cumulativeContributionsEur = state.cumulativeContributionsEur + next.monthContributionsEur;
  next.cumulativeSalesEur = state.cumulativeSalesEur + next.monthSalesEur;
  next.cumulativeRebuysEur = state.cumulativeRebuysEur + next.monthRebuysEur;
  next.cumulativeExternalPurchasesEur = state.cumulativeExternalPurchasesEur + next.monthExternalPurchasesEur;
  next.cumulativeReinvestedCapitalEur = state.cumulativeReinvestedCapitalEur + next.monthReinvestedCapitalEur;
  next.cumulativeDeployedCapitalEur = state.cumulativeDeployedCapitalEur + next.monthDeployedCapitalEur;
  next.cumulativeInternalRebuyPrincipalEur = state.cumulativeInternalRebuyPrincipalEur + next.monthInternalRebuyPrincipalEur;
  next.cumulativeInternalRebuyRealizedGainEur = state.cumulativeInternalRebuyRealizedGainEur + next.monthInternalRebuyRealizedGainEur;
  next.cumulativeTaxEur = state.cumulativeTaxEur + next.monthTaxEur;
  next.cumulativeRealizedGainEur = state.cumulativeRealizedGainEur + next.monthRealizedGainEur;
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
  yearCoverageStates: CoverageState[],
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
  const realizedGainEur = monthsOfYear.reduce((s, m) => s + m.monthRealizedGainEur, 0);
  const eurcReinvestedEur = monthsOfYear.reduce((s, m) => s + m.monthEurcReinvestedEur, 0);
  const netEurcInflowEur = monthsOfYear.reduce((s, m) => s + m.monthNetEurcInflowEur, 0);
  const externalPurchasesEur = monthsOfYear.reduce((s, m) => s + m.monthExternalPurchasesEur, 0);
  const reinvestedCapitalEur = monthsOfYear.reduce((s, m) => s + m.monthReinvestedCapitalEur, 0);
  const deployedCapitalEur = monthsOfYear.reduce((s, m) => s + m.monthDeployedCapitalEur, 0);
  const internalRebuyPrincipalEur = monthsOfYear.reduce((s, m) => s + m.monthInternalRebuyPrincipalEur, 0);
  const currentInvestedCapitalEur = calcInvestedCapital(lastMonth, prices, mKey);
  const openCostBasisEur = calcOpenCostBasis(lastMonth);
  const internalRebuyMetrics = calcInternalRebuyMetrics(lastMonth, prices, mKey);
  const externalContributionsCumulativeEur = input.historicalCapitalEur + lastMonth.cumulativeContributionsEur;
  const reinvestedCapitalCumulativeEur = lastMonth.cumulativeReinvestedCapitalEur;
  const deployedCapitalCumulativeEur = input.historicalCapitalEur + lastMonth.cumulativeExternalPurchasesEur + lastMonth.cumulativeReinvestedCapitalEur;
  const netProfitEur = closingWealthEur - externalContributionsCumulativeEur;

  const marketGainEur = closingWealthEur - openingWealthEur - contributionsEur + commissionsEur;

  // TWR real: encadenamiento de sub-períodos mensuales.
  // Para cada mes: r_m = (cierre - apertura - aportación) / (apertura + aportación)
  // La aportación se trata como capital disponible desde el inicio del mes (DCA al principio).
  // Esto elimina el efecto del tamaño de las aportaciones sobre la rentabilidad.
  {
    var twrProd = 1.0;
    var prevW = openingWealthEur;
    for (const ms of monthsOfYear) {
      const closing = calcMonthlyWealth(ms, prices);
      const contrib = ms.monthContributionsEur;
      const denom = prevW + contrib;
      const gain = closing - prevW - contrib + ms.monthCommissionsEur;
      if (denom > 0.01) twrProd *= (1 + gain / denom);
      prevW = closing;
    }
  }
  const annualReturnPct = (twrProd - 1) * 100;

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
    realizedGainEur,
    eurcReinvestedEur,
    netEurcInflowEur,
    externalPurchasesEur,
    reinvestedCapitalEur,
    deployedCapitalEur,
    internalRebuyPrincipalEur,
    cumulativeInternalRebuyPrincipalEur: lastMonth.cumulativeInternalRebuyPrincipalEur,
    internalRebuyOpenCostBasisEur: internalRebuyMetrics.openCostBasisEur,
    internalRebuyCurrentMarketValueEur: internalRebuyMetrics.currentMarketValueEur,
    internalRebuyUnrealizedGainEur: internalRebuyMetrics.unrealizedGainEur,
    internalRebuyRealizedGainEur: internalRebuyMetrics.realizedGainEur,
    internalRebuyTotalReturnEur: internalRebuyMetrics.totalReturnEur,
    internalRebuyTotalReturnPct: internalRebuyMetrics.totalReturnPct,
    internalRebuyUnitsOpen: internalRebuyMetrics.unitsOpen,
    internalRebuyUnitsSold: internalRebuyMetrics.unitsSold,
    fiscalReserveEur: lastMonth.eurcFiscalReserve,
    eurcFreeEur: lastMonth.eurcFree,
    eurCashEur: lastMonth.eurCash,
    currentInvestedCapitalEur,
    openCostBasisEur,
    externalContributionsCumulativeEur,
    reinvestedCapitalCumulativeEur,
    deployedCapitalCumulativeEur,
    netProfitEur,
    annualReturnPct,
    positions,
    events,
    salesSkipReasons,
    rebuysSkipReasons,
    forecastCoverage: yearCoverageStates.some(s => s !== "insufficient") ? "covered" : "uncovered",
  };
}

function buildAnnualStrategyReview(ctx: {
  year: number;
  monthsOfYear: MonthlyState[];
  annualSnapshot: AnnualSnapshot;
  prices: Record<string, Record<string, number>>;
  marketRegimes: Record<string, Record<string, MarketRegime>>;
  lastMonthPrevYear: MonthlyState | null;
  simInput: SimInput;
  twrCumulativeToYear: number | null;
  xirrToYear: number | null;
  maxDrawdownPct: number | null;
}): AnnualStrategyReview {
  const firstMonth = ctx.monthsOfYear[0];
  const lastMonth = ctx.monthsOfYear[ctx.monthsOfYear.length - 1];
  const openingState = ctx.lastMonthPrevYear ?? firstMonth;
  const openingUnitsByAsset: Record<string, number> = {};
  const closingUnitsByAsset: Record<string, number> = {};

  for (const [assetId, st] of Object.entries(openingState.assetStates)) {
    openingUnitsByAsset[assetId] = st.balance;
  }
  for (const [assetId, st] of Object.entries(lastMonth.assetStates)) {
    closingUnitsByAsset[assetId] = st.balance;
  }

  const regimeCounts: Record<string, number> = {};
  const allDiscardedReasons: string[] = [];
  let saleEvaluations = 0;
  let rebuyEvaluations = 0;

  const monthlyDecisions = ctx.monthsOfYear.map((ms) => {
    const mKey = monthKey(ms.monthDate);
    const decisions = new Set<MonthlyDecisionType>();
    const discardedReasons: string[] = [];
    const evaluatedAssetIds: string[] = [];
    const executedEvents = ms.events.filter(e =>
      e.type === "sale" || e.type === "rebuy" || e.type === "reinvestment" || e.type === "substitution" || e.type === "purchase"
    );

    if (ms.monthContributionsEur > 0) decisions.add("CONTINUE_PLAN_BUYING");
    if (ms.monthSalesEur > 0) decisions.add("EXECUTE_PARTIAL_SALE");
    if (ms.monthRebuysEur > 0) decisions.add("EXECUTE_PARTIAL_REBUY");
    if (ms.monthEurcReinvestedEur > 0) decisions.add("REALLOCATE_IF_ALLOWED");
    if (ms.eurcFree > 0.01) decisions.add("KEEP_EURC_LIQUIDITY");

    for (const [assetId, st] of Object.entries(ms.assetStates)) {
      if (!st || st.balance <= 0 || st.failed) continue;
      evaluatedAssetIds.push(assetId);
      const regime = ctx.marketRegimes[assetId]?.[mKey] ?? "INSUFFICIENT_DATA";
      regimeCounts[regime] = (regimeCounts[regime] ?? 0) + 1;
      const priceEur = ctx.prices[assetId]?.[mKey] ?? null;
      const avgCost = st.avgCostEur;

      if (regime === "EUPHORIA" || regime === "DISTRIBUTION") {
        decisions.add("PREPARE_PARTIAL_SALE");
      }
      if (regime === "CORRECTION" || regime === "CAPITULATION" || regime === "ACCUMULATION") {
        decisions.add("PREPARE_REBUY");
      }
      if (regime === "BEAR_MARKET" || regime === "CORRECTION") {
        decisions.add("WAIT_FOR_STABILIZATION");
      }
      if (regime === "INSUFFICIENT_DATA") {
        decisions.add("HOLD");
        discardedReasons.push(`${assetId}: datos insuficientes para venta o recompra tactica`);
      }

      if (priceEur != null && avgCost != null && avgCost > 0) {
        const multiple = priceEur / avgCost;
        if (multiple < 3) {
          discardedReasons.push(`${assetId}: venta descartada, multiplicador ${multiple.toFixed(2)}x inferior al umbral tactico`);
        } else if (ms.monthSalesEur <= 0) {
          discardedReasons.push(`${assetId}: venta evaluada, sin regla activa ejecutable en este mes`);
        }
      }

      if (ms.eurcFree <= 0.01) {
        discardedReasons.push(`${assetId}: recompra descartada, sin EURC operativo procedente de ventas previas`);
      } else if (ms.monthRebuysEur <= 0) {
        discardedReasons.push(`${assetId}: recompra evaluada, se conserva EURC hasta estabilizacion o mejor zona`);
      }
    }

    if (decisions.has("PREPARE_REBUY") && !decisions.has("EXECUTE_PARTIAL_REBUY")) {
      decisions.add("WAIT_FOR_STABILIZATION");
    }
    if (decisions.size === 0) decisions.add("HOLD");

    saleEvaluations += evaluatedAssetIds.length;
    if (ms.eurcFree > 0.01) rebuyEvaluations += evaluatedAssetIds.length;
    allDiscardedReasons.push(...discardedReasons);

    return {
      month: mKey,
      decisions: [...decisions],
      executedEvents,
      discardedReasons,
      eurcOperatingLiquidityEur: ms.eurcFree,
      fiscalReserveEur: ms.eurcFiscalReserve,
      evaluatedAssetIds,
      usesFutureInformation: false as const,
    };
  });

  const sortedRegimes = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1]);
  const topReasons = Object.entries(
    allDiscardedReasons.reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => count > 1 ? `${reason} (${count} meses)` : reason);

  const openingEurc = ctx.lastMonthPrevYear?.eurcFree ?? ctx.simInput.eurcFree;
  const wealthExpected =
    ctx.annualSnapshot.openingWealthEur +
    ctx.annualSnapshot.contributionsEur +
    ctx.annualSnapshot.marketGainEur -
    ctx.annualSnapshot.commissionsEur;
  const wealthDiffEur = ctx.annualSnapshot.closingWealthEur - wealthExpected;
  const eurcExpected = openingEurc + ctx.annualSnapshot.netEurcInflowEur - ctx.annualSnapshot.rebuysEur;
  const eurcDiffEur = ctx.annualSnapshot.eurcFreeEur - eurcExpected;
  const toleranceEur = 0.01;

  return {
    year: ctx.year,
    monthCount: ctx.monthsOfYear.length,
    monthlyDecisions,
    openingWealthEur: ctx.annualSnapshot.openingWealthEur,
    externalContributionsEur: ctx.annualSnapshot.contributionsEur,
    planPurchasesEur: ctx.annualSnapshot.externalPurchasesEur,
    tacticalPurchasesEur: 0,
    partialSalesEur: ctx.annualSnapshot.salesEur,
    realizedGainEur: ctx.annualSnapshot.realizedGainEur,
    taxGeneratedEur: ctx.annualSnapshot.taxEur,
    eurcGeneratedEur: ctx.annualSnapshot.netEurcInflowEur,
    rebuysEur: ctx.annualSnapshot.rebuysEur,
    reinvestedCapitalEur: ctx.annualSnapshot.reinvestedCapitalEur,
    internalRebuyPrincipalEur: ctx.annualSnapshot.internalRebuyPrincipalEur,
    cumulativeInternalRebuyPrincipalEur: ctx.annualSnapshot.cumulativeInternalRebuyPrincipalEur,
    internalRebuyOpenCostBasisEur: ctx.annualSnapshot.internalRebuyOpenCostBasisEur,
    internalRebuyCurrentMarketValueEur: ctx.annualSnapshot.internalRebuyCurrentMarketValueEur,
    internalRebuyUnrealizedGainEur: ctx.annualSnapshot.internalRebuyUnrealizedGainEur,
    internalRebuyRealizedGainEur: ctx.annualSnapshot.internalRebuyRealizedGainEur,
    internalRebuyTotalReturnEur: ctx.annualSnapshot.internalRebuyTotalReturnEur,
    internalRebuyTotalReturnPct: ctx.annualSnapshot.internalRebuyTotalReturnPct,
    internalRebuyUnitsOpen: ctx.annualSnapshot.internalRebuyUnitsOpen,
    internalRebuyUnitsSold: ctx.annualSnapshot.internalRebuyUnitsSold,
    finalEurcEur: ctx.annualSnapshot.eurcFreeEur,
    finalFiscalReserveEur: ctx.annualSnapshot.fiscalReserveEur,
    openingUnitsByAsset,
    closingUnitsByAsset,
    marketGainEur: ctx.annualSnapshot.marketGainEur,
    closingGrossEur: ctx.annualSnapshot.closingGrossEur,
    closingNetEur: ctx.annualSnapshot.closingWealthEur,
    cumulativeProfitEur: ctx.annualSnapshot.netProfitEur,
    twrYear: ctx.annualSnapshot.annualReturnPct == null ? null : ctx.annualSnapshot.annualReturnPct / 100,
    twrCumulative: ctx.twrCumulativeToYear,
    xirrToYear: ctx.xirrToYear,
    maxDrawdownPct: ctx.maxDrawdownPct,
    predominantRegime: sortedRegimes[0]?.[0] ?? null,
    executedDecisionCount: monthlyDecisions.reduce((sum, m) => sum + m.executedEvents.length, 0),
    discardedDecisionCount: allDiscardedReasons.length,
    saleEvaluations,
    rebuyEvaluations,
    monthsInEurc: ctx.monthsOfYear.filter(m => m.eurcFree > 0.01).length,
    averageEurcEur: ctx.monthsOfYear.reduce((sum, m) => sum + m.eurcFree, 0) / ctx.monthsOfYear.length,
    topReasonsNotToAct: topReasons,
    reconciliation: {
      wealthDiffEur,
      eurcDiffEur,
      toleranceEur,
      passed: Math.abs(wealthDiffEur) <= toleranceEur && Math.abs(eurcDiffEur) <= toleranceEur,
    },
  };
}

// ─── XIRR simplificado ───────────────────────────────────────────────────────

function calcXirr(
  initialInvestment: number,
  contributions: Array<{ date: number; amount: number }>,
  finalValue: number,
  finalDate: number,
  initialDate: number,   // t=0 para todos los flujos (= input.now)
): number | null {
  if (finalValue <= 0) return null;
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
  // Newton-Raphson XIRR
  // t=0 es initialDate (inversión inicial). Las aportaciones se sitúan en su
  // fecha real relativa a ese t=0, eliminando el sesgo que causaba usar
  // contributions[0].date como referencia (colocaba el año 1 en t=0).
  const cashFlows = [
    { t: 0, v: -initialInvestment },
    ...contributions.map(c => ({
      t: (c.date - initialDate) / MS_PER_YEAR,
      v: -c.amount,
    })),
    { t: (finalDate - initialDate) / MS_PER_YEAR, v: finalValue },
  ];

  const npv = (rate: number) =>
    cashFlows.reduce((s, cf) => s + cf.v / Math.pow(1 + rate, cf.t), 0);

  // Newton-Raphson desde varios puntos de arranque (cubre tanto retornos
  // positivos como negativos; la raíz puede estar en [-0.99, +∞)).
  const tryNR = (start: number): number | null => {
    let r = start;
    for (let iter = 0; iter < 120; iter++) {
      let f = 0, df = 0;
      for (const cf of cashFlows) {
        const base = 1 + r;
        if (base <= 0) return null;
        const factor = Math.pow(base, cf.t);
        f  += cf.v / factor;
        df -= cf.t * cf.v / (factor * base);
      }
      if (Math.abs(df) < 1e-12) break;
      const nr = r - f / df;
      if (!isFinite(nr) || nr <= -0.9999) return null;
      if (Math.abs(nr - r) < 1e-8) return nr;
      r = nr;
    }
    return isFinite(r) && r > -0.9999 ? r : null;
  };

  // Intenta primero un arranque optimista, luego pesimista.
  for (const start of [0.10, -0.10, 0.50, -0.30]) {
    const r = tryNR(start);
    if (r !== null) return r;
  }

  // Bisección de respaldo: garantiza convergencia si existe raíz en [-0.95, 20].
  const lo = -0.95, hi = 20.0;
  const flo = npv(lo), fhi = npv(hi);
  if (Math.sign(flo) === Math.sign(fhi)) return null; // sin raíz en el rango
  let a = lo, b = hi;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (Math.abs(b - a) < 1e-8) return mid;
    if (Math.sign(npv(mid)) === Math.sign(npv(a))) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

// ─── Máximo drawdown ─────────────────────────────────────────────────────────

// Recibe la serie de patrimonio neto mensual (incluyendo el valor inicial en [0])
// para detectar correcciones intra-anuales que los cierres diciembre-diciembre ocultan.
function calcMaxDrawdown(monthlyWealth: number[]): number | null {
  if (monthlyWealth.length < 2) return null;
  let peak = monthlyWealth[0];
  let maxDD = 0;
  for (const w of monthlyWealth) {
    if (w > peak) peak = w;
    if (peak > 0) {
      const dd = (peak - w) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD > 0.001 ? maxDD : null; // null si drawdown < 0.1% (ruido de redondeo)
}

// ─── Ejecución de un escenario completo ──────────────────────────────────────

function runScenario(
  input: SimInput,
  scenario: "conservador" | "moderado" | "base" | "favorable" | "optimista",
  forecastDataset: ForecastDataset,
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

  // Construir mapas de precios a partir exclusivamente de previsiones externas verificables.
  // Los anclajes externos fijan la escala de largo plazo; la trayectoria mensual
  // la genera el motor de regímenes para evitar interpolaciones alcistas lineales.
  const externalResultsByAsset: Record<string, ReturnType<typeof buildExternalPriceMap>> = {};
  const marketPathsByAsset: Record<string, MarketRegimePath> = {};
  const marketRegimes: Record<string, Record<string, MarketRegime>> = {};
  const prices: Record<string, Record<string, number>> = {};
  for (const assetId of allAssetIds) {
    const currentPrice = currentPriceMap[assetId];
    if (currentPrice == null || currentPrice <= 0) {
      // Sin precio actual verificado: excluir del mapa de precios.
      // Las compras asignadas a este activo irán a eurcFree en el motor.
      externalResultsByAsset[assetId] = {
        pricesByMonth: {},
        coverageByYear: {},
        directYears: [],
        interpolatedYears: [],
        modeledYears: [],
        insufficientYears: [],
        lastCoveredYear: null,
        sourceCount: 0,
      };
      marketRegimes[assetId] = {};
      prices[assetId] = {};
      continue;
    }
    const result = buildExternalPriceMap(
      assetId,
      currentPrice,
      scenario,
      input.now,
      input.horizonDate,
      forecastDataset.sources,
      { usdToEurRate: forecastDataset.usdToEurRate, fxSource: forecastDataset.fxSource },
    );
    const tier = getAssetTier(assetId);
    const marketPath = buildMarketRegimePricePath({
      assetId,
      tier,
      scenario,
      currentPriceEur: currentPrice,
      nowMs: input.now,
      horizonMs: input.horizonDate,
      anchorPricesByMonth: result.pricesByMonth,
      seed: stableSeed(`${assetId}:${input.now}:${input.horizonDate}:shared-market-path-v1`),
    });
    externalResultsByAsset[assetId] = result;
    marketPathsByAsset[assetId] = marketPath;
    marketRegimes[assetId] = marketPath.regimesByMonth;
    prices[assetId] = marketPath.pricesByMonth;
  }

  // Trazabilidad de previsiones por activo (exclusivamente externa)
  const horizonMKey = monthKey(input.horizonDate);
  const horizonYear = new Date(input.horizonDate).getFullYear();
  const assetPriceInfo: Record<string, AssetPriceInfo> = {};
  for (const assetId of allAssetIds) {
    const currentPos = input.currentPositions.find(p => p.assetId === assetId);
    const currentPriceEur = currentPos?.currentPriceEur ?? null;
    const horizonPriceEur = prices[assetId]?.[horizonMKey] ?? null;
    const tier = getAssetTier(assetId);
    const extResult = externalResultsByAsset[assetId];
    const priceMultiple = currentPriceEur && currentPriceEur > 0 && horizonPriceEur
      ? horizonPriceEur / currentPriceEur : null;
    const supplyM = CIRCULATING_SUPPLY_M[assetId.toUpperCase()] ?? null;
    const impliedMarketCapBnEur = supplyM != null && horizonPriceEur != null
      ? (horizonPriceEur * supplyM) / 1_000 : null;
    const horizonCoverage = extResult.coverageByYear[horizonYear] ?? "insufficient";
    const modelType =
      horizonCoverage === "direct"        ? "external_direct" :
      horizonCoverage === "interpolated"  ? "external_interpolated" :
      horizonCoverage === "modeled"       ? "external_modeled" :
                                            "insufficient";
    assetPriceInfo[assetId] = {
      assetId, tier, currentPriceEur, horizonPriceEur, priceMultiple,
      modelType,
      externalSourceCount: extResult.sourceCount,
      directCoverageYears: extResult.directYears,
      interpolatedCoverageYears: extResult.interpolatedYears,
      modeledCoverageYears: extResult.modeledYears,
      insufficientYears: extResult.insufficientYears,
      lastCoveredYear: extResult.lastCoveredYear,
      circulatingSupplyM: supplyM,
      impliedMarketCapBnEur,
      impliedMarketCapWarning: impliedMarketCapBnEur != null && impliedMarketCapBnEur > 5_000,
    };
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
    state = simulateMonth(state, d.getTime(), input, prices, marketRegimes, options);
    allMonthlyStates.push({ year: d.getFullYear(), state });
    d.setMonth(d.getMonth() + 1);
  }

  // Group by year; track monthly opening wealth for TWR
  const byYear: Record<number, MonthlyState[]> = {};
  for (const { year, state: ms } of allMonthlyStates) {
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(ms);
  }

  // calcWealth: alias local que pasa prices al helper top-level
  const calcWealth = (ms: MonthlyState, _mK?: string) => calcMonthlyWealth(ms, prices);

  const years = Object.keys(byYear).map(Number).sort();
  const annualSnapshots: AnnualSnapshot[] = [];
  let prevYearLastMonth: MonthlyState | null = null;

  for (const year of years) {
    const monthsOfYear = byYear[year];
    // Aggregate coverage state for this year across all assets
    const yearCoverageStates: CoverageState[] = allAssetIds.map(id =>
      externalResultsByAsset[id]?.coverageByYear[year] ?? "insufficient"
    );
    const snap = buildAnnualSnapshot(year, monthsOfYear, prices, prevYearLastMonth, input, yearCoverageStates);
    annualSnapshots.push(snap);
    prevYearLastMonth = monthsOfYear[monthsOfYear.length - 1];
  }

  const initialWealthForAnnualReviews = input.currentPositions.reduce(
    (s, p) => s + p.balance * (p.currentPriceEur ?? 0), 0
  ) + input.eurcFree + input.eurCash;
  const annualStrategyReviews: AnnualStrategyReview[] = [];
  let reviewPrevYearLastMonth: MonthlyState | null = null;
  let reviewTwrProduct = 1.0;
  for (const snap of annualSnapshots) {
    const monthsOfYear = byYear[snap.year] ?? [];
    reviewTwrProduct *= 1 + ((snap.annualReturnPct ?? 0) / 100);
    const monthsToYear = allMonthlyStates
      .filter(({ year }) => year <= snap.year)
      .map(({ state: ms }) => ms);
    const contributionsToYear = monthsToYear
      .filter(ms => ms.monthContributionsEur > 0)
      .map(ms => ({
        date: Math.max(input.now, ms.monthDate),
        amount: ms.monthContributionsEur,
      }));
    const wealthSeriesToYear = [initialWealthForAnnualReviews, ...monthsToYear.map(ms => calcWealth(ms, monthKey(ms.monthDate)))];
    annualStrategyReviews.push(buildAnnualStrategyReview({
      year: snap.year,
      monthsOfYear,
      annualSnapshot: snap,
      prices,
      marketRegimes,
      lastMonthPrevYear: reviewPrevYearLastMonth,
      simInput: input,
      twrCumulativeToYear: reviewTwrProduct - 1,
      xirrToYear: calcXirr(
        initialWealthForAnnualReviews,
        contributionsToYear,
        snap.closingWealthEur,
        monthsOfYear[monthsOfYear.length - 1]?.monthDate ?? input.horizonDate,
        input.now,
      ),
      maxDrawdownPct: calcMaxDrawdown(wealthSeriesToYear),
    }));
    reviewPrevYearLastMonth = monthsOfYear[monthsOfYear.length - 1] ?? reviewPrevYearLastMonth;
  }

  // Summary
  const lastSnap = annualSnapshots[annualSnapshots.length - 1];

  // Patrimonio neto inicial: excluye reserva fiscal (equivalente a openingWealthEur año 1)
  const initialWealth = input.currentPositions.reduce(
    (s, p) => s + p.balance * (p.currentPriceEur ?? 0), 0
  ) + input.eurcFree + input.eurCash; // NO input.eurcFiscalReserve

  // TWR acumulado: encadenamiento de sub-períodos mensuales.
  // r_m = (cierre - apertura - aportación) / (apertura + aportación)
  // Consistente con el TWR anual calculado en buildAnnualSnapshot.
  let twrProduct = 1.0;
  {
    let pw = initialWealth;
    for (const { state: ms } of allMonthlyStates) {
      const closing = calcMonthlyWealth(ms, prices);
      const contrib = ms.monthContributionsEur;
      const denom = pw + contrib;
      const gain = closing - pw - contrib + ms.monthCommissionsEur;
      if (denom > 0.01) twrProduct *= (1 + gain / denom);
      pw = closing;
    }
  }
  const twrAnnual = allMonthlyStates.length > 0
    ? Math.pow(twrProduct, 12 / allMonthlyStates.length) - 1
    : null;
  const twrCumulative = allMonthlyStates.length > 0 ? twrProduct - 1 : null;

  // XIRR usa solo flujos externos con su fecha mensual real.
  // Ventas, recompras, EURC y redistribuciones internas no son flujos externos.
  const contributions = allMonthlyStates
    .filter(({ state: ms }) => ms.monthContributionsEur > 0)
    .map(({ state: ms }) => ({
      date: Math.max(input.now, ms.monthDate),
      amount: ms.monthContributionsEur,
    }));

  const xirr = calcXirr(
    initialWealth,
    contributions,
    lastSnap?.closingWealthEur ?? 0,
    input.horizonDate,
    input.now,  // t=0 correcto: fecha de la inversión inicial
  );

  // Serie mensual de patrimonio neto (incluye t=0 inicial) para detectar
  // drawdowns intra-anuales que los cierres diciembre-diciembre enmascaran.
  const monthlyWealthSeries: number[] = [initialWealth];
  for (const { state: ms } of allMonthlyStates) {
    monthlyWealthSeries.push(calcWealth(ms, monthKey(ms.monthDate)));
  }
  const maxDD = calcMaxDrawdown(monthlyWealthSeries);

  const finalState = prevYearLastMonth;
  const lastMKeyForSummary = finalState ? monthKey(finalState.monthDate) : "";
  const finalCurrentInvestedCapitalEur = finalState ? calcInvestedCapital(finalState, prices, lastMKeyForSummary) : 0;
  const finalOpenCostBasisEur = finalState ? calcOpenCostBasis(finalState) : 0;
  const totalFutureExternalContributionsEur = annualSnapshots.reduce((s, a) => s + a.contributionsEur, 0);
  const totalExternalPurchasesEur = annualSnapshots.reduce((s, a) => s + a.externalPurchasesEur, 0);
  const totalReinvestedCapitalEur = annualSnapshots.reduce((s, a) => s + a.reinvestedCapitalEur, 0);
  const cumulativeDeployedCapitalEur = input.historicalCapitalEur + totalExternalPurchasesEur + totalReinvestedCapitalEur;
  const finalGrossWealthEur = lastSnap?.closingGrossEur ?? initialWealth;
  const externalContributionsEur = input.historicalCapitalEur + totalFutureExternalContributionsEur;
  const netProfitEur = (lastSnap?.closingWealthEur ?? initialWealth) - externalContributionsEur;
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
    strategyEnabled: resolveStrategyMode(options) !== "PASSIVE",
    strategyMode: resolveStrategyMode(options),
    strategySource: strategySource(resolveStrategyMode(options)),
    simulationOnly: true,
    requiresUserConfirmation: true,
    initialWealthEur: initialWealth,
    finalNetWealthEur: lastSnap?.closingWealthEur ?? initialWealth,
    initialCapitalEur: input.historicalCapitalEur,
    totalContributionsEur: totalFutureExternalContributionsEur,
    externalContributionsEur,
    totalHistoricalCapitalEur: input.historicalCapitalEur,
    totalExternalPurchasesEur,
    reinvestedCapitalEur: totalReinvestedCapitalEur,
    cumulativeDeployedCapitalEur,
    internalRebuyPrincipalEur: annualSnapshots.reduce((s, a) => s + a.internalRebuyPrincipalEur, 0),
    cumulativeInternalRebuyPrincipalEur: lastSnap?.cumulativeInternalRebuyPrincipalEur ?? 0,
    internalRebuyOpenCostBasisEur: lastSnap?.internalRebuyOpenCostBasisEur ?? 0,
    internalRebuyCurrentMarketValueEur: lastSnap?.internalRebuyCurrentMarketValueEur ?? 0,
    internalRebuyUnrealizedGainEur: lastSnap?.internalRebuyUnrealizedGainEur ?? 0,
    internalRebuyRealizedGainEur: lastSnap?.internalRebuyRealizedGainEur ?? 0,
    internalRebuyTotalReturnEur: lastSnap?.internalRebuyTotalReturnEur ?? 0,
    internalRebuyTotalReturnPct: lastSnap?.internalRebuyTotalReturnPct ?? null,
    internalRebuyUnitsOpen: lastSnap?.internalRebuyUnitsOpen ?? 0,
    internalRebuyUnitsSold: lastSnap?.internalRebuyUnitsSold ?? 0,
    currentInvestedCapitalEur: finalCurrentInvestedCapitalEur,
    eurcOperatingLiquidityEur: lastSnap?.eurcFreeEur ?? 0,
    eurcFiscalReserveEur: lastSnap?.fiscalReserveEur ?? 0,
    eurcSecurityReserveEur: 0,
    openCostBasisEur: finalOpenCostBasisEur,
    grossWealthEur: finalGrossWealthEur,
    netProfitEur,
    totalMarketGainEur: annualSnapshots.reduce((s, a) => s + a.marketGainEur, 0),
    realizedSalesEur: 0,
    realizedRebuysEur: 0,
    realizedTaxEur: 0,
    simulatedUserRuleSalesEur: resolveStrategyMode(options) === "USER_RULES" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "sale" && e.origin === "USER_RULE").reduce((sum, e) => sum + (e.amountEur ?? 0), 0), 0)
      : 0,
    simulatedUserRuleRebuysEur: resolveStrategyMode(options) === "USER_RULES" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "rebuy" && e.origin === "USER_RULE").reduce((sum, e) => sum + (e.amountEur ?? 0), 0), 0)
      : 0,
    simulatedUserRuleTaxEur: resolveStrategyMode(options) === "USER_RULES" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "sale" && e.origin === "USER_RULE").reduce((sum, e) => sum + (e.taxEur ?? 0), 0), 0)
      : 0,
    simulatedStrategicSalesEur: resolveStrategyMode(options) === "INTELLIGENT_STRATEGY" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "sale" && e.origin === "INTELLIGENT_STRATEGY").reduce((sum, e) => sum + (e.amountEur ?? 0), 0), 0)
      : 0,
    simulatedStrategicRebuysEur: resolveStrategyMode(options) === "INTELLIGENT_STRATEGY" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "rebuy" && e.origin === "INTELLIGENT_STRATEGY").reduce((sum, e) => sum + (e.amountEur ?? 0), 0), 0)
      : 0,
    simulatedStrategicTaxEur: resolveStrategyMode(options) === "INTELLIGENT_STRATEGY" || resolveStrategyMode(options) === "HYBRID"
      ? annualSnapshots.reduce((s, a) => s + a.events.filter(e => e.type === "sale" && e.origin === "INTELLIGENT_STRATEGY").reduce((sum, e) => sum + (e.taxEur ?? 0), 0), 0)
      : 0,
    proposedSalesEur: annualSnapshots.reduce((s, a) => s + a.salesEur, 0),
    proposedRebuysEur: annualSnapshots.reduce((s, a) => s + a.rebuysEur, 0),
    projectedEurcReserve: lastSnap?.eurcFreeEur ?? 0,
    projectedFiscalReserve: lastSnap?.fiscalReserveEur ?? 0,
    decision: annualSnapshots.reduce((s, a) => s + a.salesEur + a.rebuysEur, 0) > 0
      ? (resolveStrategyMode(options) === "HYBRID" ? "hybrid" : resolveStrategyMode(options) === "USER_RULES" ? "user_rules" : "intelligent_strategy")
      : "hold",
    totalSalesEur: annualSnapshots.reduce((s, a) => s + a.salesEur, 0),
    totalRebuysEur: annualSnapshots.reduce((s, a) => s + a.rebuysEur, 0),
    totalCommissionsEur: annualSnapshots.reduce((s, a) => s + a.commissionsEur, 0),
    totalTaxEur: annualSnapshots.reduce((s, a) => s + a.taxEur, 0),
    totalRealizedGainEur: annualSnapshots.reduce((s, a) => s + a.realizedGainEur, 0),
    totalUnrealizedGainEur: assetSummaries.reduce((s, a) => s + (a.finalValueEur != null && a.finalAvgCostEur != null ? a.finalValueEur - a.finalBalance * a.finalAvgCostEur : 0), 0),
    totalEurcReinvestedEur: annualSnapshots.reduce((s, a) => s + a.eurcReinvestedEur, 0),
    totalNetEurcInflowEur: annualSnapshots.reduce((s, a) => s + a.netEurcInflowEur, 0),
    initialEurcFreeEur: input.eurcFree,
    initialEurcFiscalReserveEur: input.eurcFiscalReserve,
    finalEurcFreeEur: lastSnap?.eurcFreeEur ?? 0,
    finalFiscalReserveEur: lastSnap?.fiscalReserveEur ?? 0,
    xirr,
    twr: twrAnnual,
    twrCumulative,
    twrAnnualized: twrAnnual,
    maxDrawdownPct: maxDD,
    assetSummaries,
  };

  const marketDiagnostics = Object.values(marketPathsByAsset).reduce(
    (acc, path) => {
      for (const point of path.points) {
        if (point.assetReturn < -0.0001) acc.negativeMonths += 1;
        acc.regimeCounts[point.regime] = (acc.regimeCounts[point.regime] ?? 0) + 1;
      }
      return acc;
    },
    { negativeMonths: 0, regimeCounts: {} as Record<string, number> },
  );

  return {
    scenario,
    label: SCENARIO_LABELS[scenario],
    annualSnapshots,
    annualStrategyReviews,
    summary,
    assetPriceInfo,
    marketDiagnostics,
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

export function runPerspectivesSimulation(
  input: SimInput,
  forecastDataset: ForecastDataset = EMPTY_FORECAST_DATASET,
): PerspectivesSimulation {
  // Each scenario must get its own copy of the cycle objects because evaluateSales
  // mutates rule.triggeredAt on the rule object in-place. Without cloning, the first
  // scenario that triggers a sale marks the rule as used for ALL subsequent scenarios.
  const cloneInputForScenario = (source: SimInput): SimInput => ({
    ...source,
    cycles: source.cycles.map(c => ({
      ...c,
      saleRules:     c.saleRules.map(r => ({ ...r })),
      rebuyTiers:    c.rebuyTiers.map(t => ({ ...t })),
      assets:        c.assets.map(a => ({ ...a })),
      substitutions: c.substitutions.map(s => ({ ...s })),
      revisions:     c.revisions.map(r => ({ ...r })),
    })),
  });
  const runScenarioSet = (source: SimInput) => SIM_SCENARIOS.map(scenario => {
    const localInput: SimInput = {
      ...cloneInputForScenario(source),
    };
    return runScenario(localInput, scenario, forecastDataset);
  });
  const toOrderedQuantileScenarios = (rawResults: ScenarioResult[]): ScenarioResult[] => {
    const sorted = [...rawResults].sort((a, b) => a.summary.finalNetWealthEur - b.summary.finalNetWealthEur);
    return SIM_SCENARIOS.map((scenario, index) => {
      const source = sorted[Math.min(index, sorted.length - 1)];
      return {
        ...source,
        scenario,
        label: SCENARIO_LABELS[scenario],
        summary: {
          ...source.summary,
          scenario,
        },
      };
    });
  };
  const results = toOrderedQuantileScenarios(runScenarioSet(input));

  // El ajuste monotónico artificial ha sido eliminado.
  // Los escenarios producen sus propios resultados sin corrección posterior.
  // Si un escenario optimista muestra menos patrimonio que uno moderado (p. ej. por
  // comprar a precios más altos), ese resultado se conserva y se explica en la UI.

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

  // Build diagnostics from base scenario
  const baseResult = results.find(r => r.scenario === "base");
  const negativeYearCount = baseResult
    ? baseResult.annualSnapshots.filter(s => s.marketGainEur < 0).length
    : 0;
  const negativeMonthCount = results.reduce((acc, r) =>
    acc + (r.marketDiagnostics?.negativeMonths ?? 0), 0);
  const maxDrawdownPct = baseResult?.summary.maxDrawdownPct ?? null;

  // Per-scenario diagnostics for validation
  const perScenario = results.map(r => ({
    scenario: r.scenario,
    negativeYears: r.annualSnapshots.filter(s => (s.annualReturnPct ?? 0) < -0.5).length,
    positiveYears: r.annualSnapshots.filter(s => (s.annualReturnPct ?? 0) > 0.5).length,
    lateralYears:  r.annualSnapshots.filter(s => Math.abs(s.annualReturnPct ?? 0) <= 0.5).length,
    negativeMonths: r.marketDiagnostics?.negativeMonths ?? 0,
    regimeCounts: r.marketDiagnostics?.regimeCounts ?? {},
    maxDrawdownPct: r.summary.maxDrawdownPct ?? 0,
    isStrictlyMonotonic: r.annualSnapshots.every((s, i, a) => i === 0 || s.closingWealthEur >= a[i-1].closingWealthEur),
    totalSalesEur: r.summary.totalSalesEur,
    totalRebuysEur: r.summary.totalRebuysEur,
    totalReinvestedEur: r.summary.totalEurcReinvestedEur,
  }));

  const basePerSc = perScenario.find(p => p.scenario === "base");
  const realisticCycleValidation = (
    (basePerSc?.negativeYears ?? 0) > 0 &&
    (basePerSc?.maxDrawdownPct ?? 0) > 0.05 &&
    !basePerSc?.isStrictlyMonotonic
  ) ? "passed" : "failed";
  const scenarioOrder = results.map(r => ({
    scenario: r.scenario,
    finalNetWealthEur: r.summary.finalNetWealthEur,
  }));
  const scenarioValidationStatus = scenarioOrder.every((entry, index, arr) =>
    index === 0 || entry.finalNetWealthEur >= arr[index - 1].finalNetWealthEur
  ) ? "valid_order" : "invalid_order";

  const diagnostics: SimDiagnostics = {
    engineIsNew: true,
    source: "market-regime-engine+active-forecast-anchors",
    candidateId: forecastDataset.candidateId,
    engineVersion: "perspectives-v4.0-market-regimes",
    engineBuildHash: "realtime-perspectives-engine",
    engineGeneratedAt: Date.now(),
    marketRegimeEngine: true,
    negativeMonthCount,
    negativeYearCount,
    maxDrawdownPct,
    hasBearPeriods: negativeYearCount > 0 || (maxDrawdownPct !== null && maxDrawdownPct > 0.05),
    realisticCycleValidation,
    scenarioValidationStatus,
    scenarioOrder,
    perScenario,
  };

  const modeLabels: Record<SimulationStrategyMode, string> = {
    PASSIVE: "Plan pasivo",
    USER_RULES: "Reglas del usuario",
    INTELLIGENT_STRATEGY: "Estrategia inteligente",
    HYBRID: "Estrategia híbrida",
  };
  const strategyComparisons = (["PASSIVE", "USER_RULES", "INTELLIGENT_STRATEGY", "HYBRID"] as SimulationStrategyMode[])
    .map((mode) => {
      const modeInput: SimInput = {
        ...input,
        options: {
          ...input.options,
          policy: mode === "PASSIVE" ? "plan_base" : "full_strategy",
          strategyMode: mode,
        },
      };
      const modeResults = mode === resolveStrategyMode(input.options) ? results : toOrderedQuantileScenarios(runScenarioSet(modeInput));
      return {
        mode,
        label: modeLabels[mode],
        scenarios: modeResults.map((r) => ({
          scenario: r.scenario,
          finalNetWealthEur: r.summary.finalNetWealthEur,
          benefitEur: r.summary.finalNetWealthEur - r.summary.initialWealthEur - r.summary.totalContributionsEur,
          twr: r.summary.twr,
          xirr: r.summary.xirr,
          salesEur: r.summary.totalSalesEur,
          rebuysEur: r.summary.totalRebuysEur,
          taxEur: r.summary.totalTaxEur,
          finalEurcFreeEur: r.summary.finalEurcFreeEur,
          finalFiscalReserveEur: r.summary.finalFiscalReserveEur,
          decision: r.summary.decision,
        })),
      };
    });

  return {
    computedAt: Date.now(),
    startYear,
    endYear,
    horizonDate: input.horizonDate,
    scenarios: results,
    strategyComparisons,
    validations,
    diagnostics,
  };
}
