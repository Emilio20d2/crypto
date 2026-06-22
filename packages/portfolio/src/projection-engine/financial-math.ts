// ── Financial mathematics: XIRR, TWR, ROI, independent control scenarios ─────
//
// These functions are INDEPENDENT from the projection engine (runProjection).
// They must never call runProjection or any simulation function.

/**
 * XIRR via Newton-Raphson.
 * flows: array of {date (ms), amount (EUR)} — negative = outflow (investment/contribution),
 * positive = inflow (return). The first flow is the reference date t0.
 */
export function computeXIRR(
  flows: { date: number; amount: number }[],
  guess = 0.1,
): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].date;

  // t must be in YEARS: divide ms difference by ms-per-year
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

  const npv = (r: number): number =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.date - t0) / MS_PER_YEAR), 0);

  const dnpv = (r: number): number =>
    flows.reduce((s, f) => {
      const t = (f.date - t0) / MS_PER_YEAR;
      return s - (t * f.amount) / Math.pow(1 + r, t + 1);
    }, 0);

  const newton = (start: number): number | null => {
    let r = start;
    for (let i = 0; i < 300; i++) {
      const fv = npv(r);
      const dfv = dnpv(r);
      if (!Number.isFinite(fv) || Math.abs(dfv) < 1e-14) return null;
      const rNext = r - fv / dfv;
      if (!Number.isFinite(rNext)) return null;
      if (Math.abs(rNext - r) < 1e-9) return rNext;
      r = Math.max(-0.9999, Math.min(rNext, 100));
    }
    return null;
  };

  // Try primary guess first, then fallbacks
  for (const start of [guess, 0.05, 0, 0.3, -0.5, 0.5]) {
    const result = newton(start);
    if (result !== null && Number.isFinite(result)) return result;
  }
  return null;
}

/**
 * TWR (Time-Weighted Return) — chains holding-period returns (HPR) across sub-periods.
 * HPR_i = V_end_i / (V_start_i + inflow_i)
 * Returns cumulative TWR (1.0 = flat, 1.05 = +5%).
 */
export function computeTWR(
  periods: { valueEnd: number; valueStart: number; inflow: number }[],
): number | null {
  if (periods.length === 0) return null;
  let twr = 1;
  for (const p of periods) {
    const denom = p.valueStart + p.inflow;
    if (denom <= 0) continue;
    const hpr = p.valueEnd / denom;
    if (!Number.isFinite(hpr) || hpr <= 0) continue;
    twr *= hpr;
  }
  return twr;
}

/**
 * Derives XIRR from the projection engine's period output.
 * Cash flows:
 *   -initialGrossWealthEur  at projectionStartDate
 *   -inflow_i               at each month where a contribution was made
 *   +grossWealthEur_final   at last period date
 */
export function xirrFromPeriods(params: {
  initialGrossWealthEur: number;
  projectionStartDate: number;
  periods: Array<{ date: number; futureCapitalEur: number; grossWealthEur: number }>;
}): number | null {
  const { initialGrossWealthEur, projectionStartDate, periods } = params;
  if (periods.length === 0) return null;

  const flows: { date: number; amount: number }[] = [];
  flows.push({ date: projectionStartDate, amount: -initialGrossWealthEur });

  let prevFutureCapital = 0;
  for (const p of periods) {
    const inflow = p.futureCapitalEur - prevFutureCapital;
    if (inflow > 0.01) {
      flows.push({ date: p.date, amount: -inflow });
    }
    prevFutureCapital = p.futureCapitalEur;
  }

  const last = periods[periods.length - 1];
  flows.push({ date: last.date, amount: last.grossWealthEur });

  return computeXIRR(flows);
}

/**
 * Derives TWR from the projection engine's period output.
 * Each month: HPR = grossWealth_end / (grossWealth_start + inflow)
 */
export function twrFromPeriods(params: {
  initialGrossWealthEur: number;
  periods: Array<{ date: number; futureCapitalEur: number; grossWealthEur: number }>;
}): number | null {
  if (params.periods.length === 0) return null;

  const subPeriods: { valueEnd: number; valueStart: number; inflow: number }[] = [];
  let prevWealth = params.initialGrossWealthEur;
  let prevFutureCapital = 0;

  for (const p of params.periods) {
    const inflow = p.futureCapitalEur - prevFutureCapital;
    subPeriods.push({ valueEnd: p.grossWealthEur, valueStart: prevWealth, inflow });
    prevWealth = p.grossWealthEur;
    prevFutureCapital = p.futureCapitalEur;
  }

  return computeTWR(subPeriods);
}

/**
 * Independent control scenario calculator — does NOT use runProjection.
 * Uses the closed-form future value of an annuity: FV = P*(1+r)^n + C*[(1+r)^n - 1]/r
 * where P = initial wealth, C = monthly contribution, r = monthly rate, n = months.
 *
 * Returns finalWealth and the XIRR derived from the control's own cash flows.
 */
export function computeControlScenario(params: {
  initialWealthEur: number;
  monthlyContributionEur: number;
  annualReturnRate: number;
  months: number;
  projectionStartDate: number;
}): { finalWealth: number; xirr: number | null } {
  const { initialWealthEur, monthlyContributionEur, annualReturnRate, months, projectionStartDate } = params;
  const r = annualReturnRate / 12;
  const n = months;
  const growth = Math.pow(1 + r, n);

  const finalWealth = r === 0
    ? initialWealthEur + monthlyContributionEur * n
    : initialWealthEur * growth + monthlyContributionEur * (growth - 1) / r;

  const MS_PER_MONTH = (365.25 / 12) * 24 * 3600 * 1000;
  const flows: { date: number; amount: number }[] = [
    { date: projectionStartDate, amount: -initialWealthEur },
  ];
  for (let i = 0; i < n; i++) {
    if (monthlyContributionEur > 0.01) {
      flows.push({ date: projectionStartDate + (i + 1) * MS_PER_MONTH, amount: -monthlyContributionEur });
    }
  }
  flows.push({ date: projectionStartDate + n * MS_PER_MONTH, amount: finalWealth });

  return { finalWealth: Math.round(finalWealth * 100) / 100, xirr: computeXIRR(flows) };
}
