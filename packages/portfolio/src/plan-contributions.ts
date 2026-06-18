// Domain engine for contribution tracking and monthly budget classification.
// Pure functions — no I/O, no React, independently testable.

export type ContributionMonthlyStatus =
  | "prevista"    // future period
  | "pendiente"   // current month, still open
  | "parcial"     // 0 < actual < planned
  | "cumplida"    // actual >= planned
  | "superada"    // actual > planned (same as cumplida but explicit)
  | "omitida"     // past period, no contribution
  | "cancelada";  // explicitly cancelled

export interface ContributionEntry {
  id: string;
  cycleId: string;
  type: "periodica" | "extraordinaria";
  plannedDate: number;
  amountEur: number;
  status: "pendiente" | "ejecutada" | "cancelada";
  executedAt: number | null;
  notes?: string | null;
}

export interface ContributionCycleInput {
  id: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
}

export interface OperationContributionLeg {
  assetId: string;
  amount: number;
  legType: "source" | "destination" | "fee" | string;
  valuationEur?: number | null;
  acquisitionValueEur?: number | null;
}

export interface OperationContributionTransaction {
  id: string;
  type: string;
  date: number;
  externalId?: string | null;
  cycleId?: string | null;
  notes?: string | null;
  legs: OperationContributionLeg[];
}

export interface ContributionMonthlySummary {
  yearMonth: string;        // "YYYY-MM"
  year: number;
  month: number;            // 1-12
  cycleId: string;
  plannedAmountEur: number;
  actualAmountEur: number;
  scheduledPortionEur: number;
  extraordinaryAmountEur: number;
  deficitAmountEur: number;
  status: ContributionMonthlyStatus;
  entryCount: number;
}

export interface CycleContributionAggregates {
  cycleId: string;
  totalPlannedEur: number;
  totalActualEur: number;
  totalScheduledPortionEur: number;
  totalExtraordinaryEur: number;
  totalDeficitEur: number;
  compliancePercentage: number | null;
  monthsCumplida: number;
  monthsParcial: number;
  monthsOmitida: number;
  monthsSuperada: number;
  lastContributionDate: number | null;
  nextScheduledDate: number | null;
}

function toYearMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function effectiveCycleMatch(cycle: ContributionCycleInput, tx: OperationContributionTransaction): boolean {
  if (tx.cycleId && tx.cycleId !== cycle.id) return false;
  if (tx.cycleId === cycle.id) return true;
  if (tx.date < cycle.startDate) return false;
  return cycle.endDate === null || tx.date <= cycle.endDate;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function legEuroValue(leg: OperationContributionLeg): number | null {
  return finitePositive(leg.valuationEur) ?? finitePositive(leg.acquisitionValueEur);
}

function fiatLegAmountEur(
  leg: OperationContributionLeg,
  isFiatAsset: (assetId: string) => boolean,
): number {
  if (!isFiatAsset(leg.assetId)) return 0;
  const absoluteAmount = Math.abs(leg.amount);
  return absoluteAmount > 0 ? absoluteAmount : legEuroValue(leg) ?? 0;
}

function buyAmountFromFiatOrValuation(
  tx: OperationContributionTransaction,
  isFiatAsset: (assetId: string) => boolean,
): number {
  const sourceLegs = tx.legs.filter((leg) => leg.legType === "source" && leg.amount < 0);
  const fiatSource = sourceLegs.reduce((sum, leg) => sum + fiatLegAmountEur(leg, isFiatAsset), 0);
  if (fiatSource > 0) return fiatSource;
  if (sourceLegs.length > 0) return 0;

  return tx.legs
    .filter((leg) => leg.legType === "destination" && leg.amount > 0)
    .reduce((sum, leg) => sum + (legEuroValue(leg) ?? 0), 0);
}

function operationEntry(
  tx: OperationContributionTransaction,
  amountEur: number,
  source: "deposit" | "buy",
): ContributionEntry {
  return {
    id: `coinbase-operation:${tx.externalId ?? tx.id}:${source}`,
    cycleId: tx.cycleId ?? "",
    type: "periodica",
    plannedDate: tx.date,
    amountEur,
    status: "ejecutada",
    executedAt: tx.date,
    notes: `Sincronizada desde Operaciones/Coinbase (${source === "deposit" ? "depósito fiat" : "compra EUR"})`,
  };
}

function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}

// Derive the effective contribution date for an entry (executedAt if available, else plannedDate)
function effectiveDate(entry: ContributionEntry): number {
  return entry.executedAt ?? entry.plannedDate;
}

// Build the list of month keys (YYYY-MM) spanning the cycle from start to now-or-end
function buildMonthRange(cycle: ContributionCycleInput, now: number): string[] {
  const effectiveEnd = Math.min(now, cycle.endDate ?? now);
  if (effectiveEnd < cycle.startDate) return [];

  const start = new Date(cycle.startDate);
  const end = new Date(effectiveEnd);
  const startIndex = start.getFullYear() * 12 + start.getMonth();
  const endIndex = end.getFullYear() * 12 + end.getMonth();

  const months: string[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const year = Math.floor(i / 12);
    const month = i % 12;
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
  }
  return months;
}

// Determine status for a given month
function deriveMonthStatus(
  yearMonth: string,
  actualEur: number,
  plannedEur: number,
  now: number,
): ContributionMonthlyStatus {
  const { year, month } = parseYearMonth(yearMonth);
  const nowDate = new Date(now);
  const nowYM = toYearMonth(now);

  if (yearMonth > nowYM) return "prevista";
  if (yearMonth === nowYM) {
    // Current month: not yet ended
    if (actualEur <= 0) return "pendiente";
    if (actualEur >= plannedEur) return "superada";
    return "parcial";
  }
  // Past month
  if (actualEur <= 0) return "omitida";
  if (actualEur >= plannedEur) {
    // Exactly met or exceeded
    return actualEur > plannedEur ? "superada" : "cumplida";
  }
  return "parcial";

  // Suppress unused variable warning
  void year; void month; void nowDate;
}

// Classify a month from a list of executed entries and the cycle planned amount
export function classifyMonth(
  yearMonth: string,
  entries: ContributionEntry[],
  plannedAmountEur: number,
  cycleId: string,
  now: number,
): ContributionMonthlySummary {
  const { year, month } = parseYearMonth(yearMonth);

  const executedEntries = entries.filter(e =>
    e.status === "ejecutada" &&
    toYearMonth(effectiveDate(e)) === yearMonth
  );

  const actualAmountEur = executedEntries.reduce((sum, e) => sum + e.amountEur, 0);
  const scheduledPortionEur = Math.min(actualAmountEur, plannedAmountEur);
  const extraordinaryAmountEur = Math.max(0, actualAmountEur - plannedAmountEur);
  const deficitAmountEur = Math.max(0, plannedAmountEur - actualAmountEur);
  const status = deriveMonthStatus(yearMonth, actualAmountEur, plannedAmountEur, now);

  return {
    yearMonth,
    year,
    month,
    cycleId,
    plannedAmountEur,
    actualAmountEur,
    scheduledPortionEur,
    extraordinaryAmountEur,
    deficitAmountEur,
    status,
    entryCount: executedEntries.length,
  };
}

// Build the full monthly contribution history for a cycle
export function buildContributionHistory(
  cycle: ContributionCycleInput,
  entries: ContributionEntry[],
  now: number = Date.now(),
): ContributionMonthlySummary[] {
  const months = buildMonthRange(cycle, now);
  return months.map(ym => classifyMonth(ym, entries, cycle.monthlyAmountEur, cycle.id, now));
}

export function deriveContributionEntriesFromOperations(
  cycle: ContributionCycleInput,
  transactions: OperationContributionTransaction[],
  isFiatAsset: (assetId: string) => boolean = (assetId) => assetId === "EUR",
): ContributionEntry[] {
  const grouped = new Map<string, { deposits: ContributionEntry[]; buys: ContributionEntry[] }>();

  for (const tx of transactions) {
    if (!effectiveCycleMatch(cycle, tx)) continue;
    const yearMonth = toYearMonth(tx.date);
    const group = grouped.get(yearMonth) ?? { deposits: [], buys: [] };

    if (tx.type === "transfer_in") {
      const amount = tx.legs
        .filter((leg) => leg.legType === "destination" && leg.amount > 0)
        .reduce((sum, leg) => sum + fiatLegAmountEur(leg, isFiatAsset), 0);
      if (amount > 0) group.deposits.push(operationEntry({ ...tx, cycleId: cycle.id }, amount, "deposit"));
    } else if (tx.type === "buy") {
      const amount = buyAmountFromFiatOrValuation(tx, isFiatAsset);
      if (amount > 0) group.buys.push(operationEntry({ ...tx, cycleId: cycle.id }, amount, "buy"));
    }

    if (group.deposits.length > 0 || group.buys.length > 0) grouped.set(yearMonth, group);
  }

  return [...grouped.values()]
    .flatMap((group) => group.deposits.length > 0 ? group.deposits : group.buys)
    .sort((a, b) => a.plannedDate - b.plannedDate);
}

export function mergeManualAndOperationContributions(
  manualEntries: ContributionEntry[],
  operationEntries: ContributionEntry[],
): ContributionEntry[] {
  const operationMonths = new Set(operationEntries.map((entry) => toYearMonth(effectiveDate(entry))));
  return [
    ...manualEntries.filter((entry) =>
      entry.status !== "ejecutada" ||
      !operationMonths.has(toYearMonth(effectiveDate(entry)))
    ),
    ...operationEntries,
  ].sort((a, b) => effectiveDate(a) - effectiveDate(b));
}

// Compute cycle-level aggregates from monthly summaries
export function calculateCycleContributionAggregates(
  cycle: ContributionCycleInput,
  summaries: ContributionMonthlySummary[],
  entries: ContributionEntry[],
  now: number = Date.now(),
): CycleContributionAggregates {
  // Only count closed months (not "prevista" or "pendiente") for aggregates.
  // "pendiente" is the current open month — no confirmed deficit yet.
  const closedMonths = summaries.filter(
    s => s.status !== "prevista" && s.status !== "pendiente"
  );

  let totalPlannedEur = 0;
  let totalActualEur = 0;
  let totalScheduledPortionEur = 0;
  let totalExtraordinaryEur = 0;
  let totalDeficitEur = 0;
  let monthsCumplida = 0;
  let monthsParcial = 0;
  let monthsOmitida = 0;
  let monthsSuperada = 0;

  for (const s of closedMonths) {
    totalPlannedEur += s.plannedAmountEur;
    totalActualEur += s.actualAmountEur;
    totalScheduledPortionEur += s.scheduledPortionEur;
    totalExtraordinaryEur += s.extraordinaryAmountEur;
    totalDeficitEur += s.deficitAmountEur;
    if (s.status === "cumplida") monthsCumplida++;
    else if (s.status === "parcial") monthsParcial++;
    else if (s.status === "omitida") monthsOmitida++;
    else if (s.status === "superada") monthsSuperada++;
  }

  const compliancePercentage = totalPlannedEur > 0
    ? Math.min(100, (totalActualEur / totalPlannedEur) * 100)
    : null;

  const executedEntries = entries.filter(e => e.status === "ejecutada");
  const lastContributionDate = executedEntries.length > 0
    ? Math.max(...executedEntries.map(e => effectiveDate(e)))
    : null;

  const pendingEntries = entries.filter(e => e.status === "pendiente" && e.plannedDate > now);
  const nextScheduledDate = pendingEntries.length > 0
    ? Math.min(...pendingEntries.map(e => e.plannedDate))
    : null;

  return {
    cycleId: cycle.id,
    totalPlannedEur,
    totalActualEur,
    totalScheduledPortionEur,
    totalExtraordinaryEur,
    totalDeficitEur,
    compliancePercentage,
    monthsCumplida,
    monthsParcial,
    monthsOmitida,
    monthsSuperada,
    lastContributionDate,
    nextScheduledDate,
  };
}

// Classify an individual contribution entry's origin type
// (for display: whether it is capital nuevo, rebuys, conversions, etc.)
export type ContributionOriginType =
  | "capital_nuevo"       // new fiat from outside crypto
  | "reinversion"         // reinvested gains
  | "recompra"            // buyback with existing reserves
  | "conversion"          // crypto-to-crypto conversion
  | "eurc"                // EURC-funded (internal stable)
  | "sin_clasificar";     // unknown / unclassified

// Determine the origin type based on the entry's flags.
// This heuristic can be extended as more metadata becomes available.
export function classifyContributionOrigin(
  type: "periodica" | "extraordinaria",
  notes: string | null | undefined,
): ContributionOriginType {
  const n = (notes ?? "").toLowerCase();
  if (n.includes("recompra") || n.includes("rebuy")) return "recompra";
  if (n.includes("conversión") || n.includes("conversion") || n.includes("convert")) return "conversion";
  if (n.includes("eurc")) return "eurc";
  if (n.includes("beneficio") || n.includes("reinversión") || n.includes("reinversion")) return "reinversion";
  // Periodic and extraordinary manual contributions are capital nuevo by default
  if (type === "periodica" || type === "extraordinaria") return "capital_nuevo";
  return "sin_clasificar";
}

// Check if a contribution is capital nuevo (new fiat from outside)
export function isCapitalNuevo(entry: ContributionEntry): boolean {
  return classifyContributionOrigin(entry.type, entry.notes) === "capital_nuevo";
}

// Detect potential duplicate entries (same amount, same month, same type)
export function detectDuplicateContribution(
  newEntry: Pick<ContributionEntry, "cycleId" | "type" | "plannedDate" | "amountEur">,
  existingEntries: ContributionEntry[],
): ContributionEntry | null {
  const newYM = toYearMonth(newEntry.plannedDate);
  return existingEntries.find(e =>
    e.cycleId === newEntry.cycleId &&
    e.type === newEntry.type &&
    toYearMonth(e.plannedDate) === newYM &&
    Math.abs(e.amountEur - newEntry.amountEur) < 0.01 &&
    e.status !== "cancelada"
  ) ?? null;
}

// Given a cycle, returns the monthly amount for any given date
// (currently flat — future extension point for stage-varying amounts)
export function getPlannedAmountForDate(cycle: ContributionCycleInput, _date: number): number {
  return cycle.monthlyAmountEur;
}
