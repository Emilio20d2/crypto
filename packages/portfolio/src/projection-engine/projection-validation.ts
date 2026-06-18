import type { ProjectionOutput, ReconciliationCheck, Reconciliation, ProjectionValidationResult, ValidationIssue } from "./types";

const TOLERANCE_EUR = 1.0; // 1 EUR tolerance for rounding

function check(
  name: string,
  expected: number,
  actual: number,
  tolerance = TOLERANCE_EUR,
): ReconciliationCheck {
  const delta = Math.abs(actual - expected);
  return { name, passed: delta <= tolerance, expected, actual, toleranceEur: tolerance, delta };
}

export function reconcileProjection(output: ProjectionOutput): Reconciliation {
  const first = output.periods[0];
  const last = output.periods[output.periods.length - 1];

  if (!first || !last) {
    return { checks: [], allPassed: true, toleranceEur: TOLERANCE_EUR };
  }

  const checks: ReconciliationCheck[] = [];

  // Gross wealth = portfolio + cash + eurc + fiscal reserve
  const lastExpectedGross =
    last.portfolioValueEur + last.cashEur + last.eurcAvailableEur + last.fiscalReserveEur;
  checks.push(check("Patrimonio bruto = cartera + efectivo + EURC + reserva", lastExpectedGross, last.grossWealthEur));

  // Net wealth = gross - uncovered tax liability
  const taxCovered = Math.min(last.taxPendingEur, last.fiscalReserveEur);
  const uncoveredTax = Math.max(0, last.taxPendingEur - taxCovered);
  const expectedNet = last.grossWealthEur - uncoveredTax;
  checks.push(check("Patrimonio neto = bruto − impuesto no cubierto", expectedNet, last.netWealthEur));

  // Total capital = historical + future
  checks.push(check(
    "Capital total = histórico + futuro",
    last.historicalCapitalEur + last.futureCapitalEur,
    last.totalCapitalEur,
  ));

  // Per-asset: initial + bought + rebought - sold = final
  for (const ar of output.assetResults) {
    const expectedFinal =
      ar.initialBalance + ar.balanceBoughtContributions + ar.balanceBoughtExtraordinary + ar.balanceRebought - ar.balanceSold;
    checks.push(check(
      `${ar.assetId}: cantidad cuadra`,
      expectedFinal,
      ar.finalBalance,
      0.0001, // quantity tolerance
    ));
  }

  // EURC: no fiscal reserve consumed for rebuys
  // (structural: checked in treasury simulator — no assertion needed here)

  const allPassed = checks.every(c => c.passed);
  return { checks, allPassed, toleranceEur: TOLERANCE_EUR };
}

export function validateProjectionOutput(output: ProjectionOutput): ProjectionValidationResult {
  const issues: ValidationIssue[] = [];

  // No NaN
  if (output.summary.finalGrossWealthEur !== output.summary.finalGrossWealthEur) {
    issues.push({ field: "summary.finalGrossWealthEur", message: "NaN detectado en patrimonio bruto final", severity: "error" });
  }

  // No negative impossible balances
  for (const ar of output.assetResults) {
    if (ar.finalBalance < -0.0001) {
      issues.push({ field: `assetResults.${ar.assetId}.finalBalance`, message: `Balance negativo: ${ar.finalBalance}`, severity: "error" });
    }
  }
  if (output.periods.length > 0) {
    const last = output.periods[output.periods.length - 1];
    if (last.eurcAvailableEur < -0.01) {
      issues.push({ field: "eurcAvailableEur", message: "EURC disponible negativo", severity: "error" });
    }
    if (last.fiscalReserveEur < -0.01) {
      issues.push({ field: "fiscalReserveEur", message: "Reserva fiscal negativa", severity: "error" });
    }
  }

  // Reconciliation
  if (!output.reconciliation.allPassed) {
    const failed = output.reconciliation.checks.filter(c => !c.passed);
    for (const f of failed) {
      issues.push({ field: f.name, message: `Conciliación fallida: esperado ${f.expected.toFixed(2)}, obtenido ${f.actual.toFixed(2)}, delta ${f.delta.toFixed(2)}`, severity: "error" });
    }
  }

  return { valid: issues.filter(i => i.severity === "error").length === 0, issues };
}
