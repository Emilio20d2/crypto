import type { PerspectivesSimulation, ScenarioResult, AnnualSnapshot } from "./types";

export type AccountingCheckStatus = "PASS" | "FAIL";

export interface AccountingCheck {
  scenario: string;
  scope: string;
  check: string;
  expected: number;
  actual: number;
  difference: number;
  tolerance: number;
  status: AccountingCheckStatus;
}

export interface AccountingVerificationReport {
  passed: boolean;
  tolerance: number;
  checks: AccountingCheck[];
}

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addCheck(
  checks: AccountingCheck[],
  scenario: string,
  scope: string,
  check: string,
  expected: number,
  actual: number,
  tolerance: number,
): void {
  const difference = actual - expected;
  checks.push({
    scenario,
    scope,
    check,
    expected,
    actual,
    difference,
    tolerance,
    status: Math.abs(difference) <= tolerance ? "PASS" : "FAIL",
  });
}

function verifyAnnualSnapshot(
  checks: AccountingCheck[],
  scenario: string,
  snap: AnnualSnapshot,
  previousSnap: AnnualSnapshot | null,
  initialEurcFree: number,
  tolerance: number,
): void {
  const wealthExpected =
    snap.openingWealthEur +
    snap.contributionsEur +
    snap.marketGainEur -
    snap.commissionsEur;
  addCheck(checks, scenario, String(snap.year), "annual closing net wealth", wealthExpected, snap.closingWealthEur, tolerance);

  const openingEurc = previousSnap?.eurcFreeEur ?? initialEurcFree;
  const eurcExpected = openingEurc + snap.netEurcInflowEur - snap.eurcReinvestedEur;
  addCheck(checks, scenario, String(snap.year), "annual operating EURC", eurcExpected, snap.eurcFreeEur, tolerance);

  const grossExpected = snap.closingWealthEur + snap.fiscalReserveEur;
  addCheck(checks, scenario, String(snap.year), "annual gross/net reserve bridge", grossExpected, snap.closingGrossEur, tolerance);

  const netProfitExpected = snap.closingWealthEur - snap.externalContributionsCumulativeEur;
  addCheck(checks, scenario, String(snap.year), "annual net profit", netProfitExpected, snap.netProfitEur, tolerance);

  const rebuyUnrealizedExpected = snap.internalRebuyCurrentMarketValueEur - snap.internalRebuyOpenCostBasisEur;
  addCheck(
    checks,
    scenario,
    String(snap.year),
    "annual internal rebuy unrealized gain",
    rebuyUnrealizedExpected,
    snap.internalRebuyUnrealizedGainEur,
    tolerance,
  );

  const rebuyTotalExpected = snap.internalRebuyRealizedGainEur + snap.internalRebuyUnrealizedGainEur;
  addCheck(
    checks,
    scenario,
    String(snap.year),
    "annual internal rebuy total return",
    rebuyTotalExpected,
    snap.internalRebuyTotalReturnEur,
    tolerance,
  );
}

function verifyScenarioSummary(
  checks: AccountingCheck[],
  scenarioResult: ScenarioResult,
  tolerance: number,
): void {
  const { summary, annualSnapshots } = scenarioResult;
  const scenario = scenarioResult.scenario;
  const lastSnap = annualSnapshots.at(-1);
  if (!lastSnap) return;

  addCheck(checks, scenario, "summary", "final net wealth", lastSnap.closingWealthEur, summary.finalNetWealthEur, tolerance);
  addCheck(checks, scenario, "summary", "final gross wealth", lastSnap.closingGrossEur, summary.grossWealthEur, tolerance);
  addCheck(checks, scenario, "summary", "final operating EURC", lastSnap.eurcFreeEur, summary.finalEurcFreeEur, tolerance);
  addCheck(checks, scenario, "summary", "final fiscal reserve", lastSnap.fiscalReserveEur, summary.finalFiscalReserveEur, tolerance);

  const externalCapitalExpected = summary.totalHistoricalCapitalEur + summary.totalContributionsEur;
  addCheck(checks, scenario, "summary", "external capital", externalCapitalExpected, summary.externalContributionsEur, tolerance);

  const netProfitExpected = summary.finalNetWealthEur - summary.externalContributionsEur;
  addCheck(checks, scenario, "summary", "summary net profit", netProfitExpected, summary.netProfitEur, tolerance);

  const salesExpected = annualSnapshots.reduce((sum, snap) => sum + snap.salesEur, 0);
  addCheck(checks, scenario, "summary", "total sales", salesExpected, summary.totalSalesEur, tolerance);

  const rebuysExpected = annualSnapshots.reduce((sum, snap) => sum + snap.rebuysEur, 0);
  addCheck(checks, scenario, "summary", "total rebuys", rebuysExpected, summary.totalRebuysEur, tolerance);

  const eurcReinvestedExpected = annualSnapshots.reduce((sum, snap) => sum + snap.eurcReinvestedEur, 0);
  addCheck(checks, scenario, "summary", "total EURC reinvested", eurcReinvestedExpected, summary.totalEurcReinvestedEur, tolerance);

  const rebuyPrincipalExpected = annualSnapshots.reduce((sum, snap) => sum + snap.internalRebuyPrincipalEur, 0);
  addCheck(checks, scenario, "summary", "internal rebuy principal", rebuyPrincipalExpected, summary.internalRebuyPrincipalEur, tolerance);

  addCheck(
    checks,
    scenario,
    "summary",
    "internal rebuy market value",
    lastSnap.internalRebuyCurrentMarketValueEur,
    summary.internalRebuyCurrentMarketValueEur,
    tolerance,
  );

  const rebuyTotalExpected = summary.internalRebuyRealizedGainEur + summary.internalRebuyUnrealizedGainEur;
  addCheck(
    checks,
    scenario,
    "summary",
    "internal rebuy total return",
    rebuyTotalExpected,
    summary.internalRebuyTotalReturnEur,
    tolerance,
  );

  if (summary.internalRebuyPrincipalEur > tolerance) {
    const rebuyPctExpected = summary.internalRebuyTotalReturnEur / summary.internalRebuyPrincipalEur;
    addCheck(
      checks,
      scenario,
      "summary",
      "internal rebuy return percentage",
      rebuyPctExpected,
      finite(summary.internalRebuyTotalReturnPct),
      0.000001,
    );
  }
}

export function verifyPerspectivesAccounting(
  simulation: PerspectivesSimulation,
  tolerance = 0.01,
): AccountingVerificationReport {
  const checks: AccountingCheck[] = [];

  for (const scenario of simulation.scenarios) {
    let previousSnap: AnnualSnapshot | null = null;
    for (const snap of scenario.annualSnapshots) {
      verifyAnnualSnapshot(checks, scenario.scenario, snap, previousSnap, scenario.summary.initialEurcFreeEur, tolerance);
      previousSnap = snap;
    }
    verifyScenarioSummary(checks, scenario, tolerance);
  }

  return {
    passed: checks.every(check => check.status === "PASS"),
    tolerance,
    checks,
  };
}
