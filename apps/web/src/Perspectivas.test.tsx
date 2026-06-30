import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test } from "vitest";
import { Perspectivas } from "./pages/Perspectivas";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const annualSnapshot = {
  year: 2044,
  scope: "plan" as const,
  openingWealthEur: 100_000,
  closingWealthEur: 203_747.86,
  closingGrossEur: 205_469.54,
  contributionsEur: 6_000,
  marketGainEur: 12_000,
  salesEur: 12_405.53,
  rebuysEur: 10_134.48,
  commissionsEur: 120,
  taxEur: 1_721.68,
  eurcReinvestedEur: 10_134.48,
  netEurcInflowEur: 12_405.53,
  currentInvestedCapitalEur: 203_198.32,
  openCostBasisEur: 76_888.32,
  externalContributionsCumulativeEur: 70_097.91,
  reinvestedCapitalCumulativeEur: 10_134.48,
  deployedCapitalCumulativeEur: 80_232.40,
  internalRebuyPrincipalEur: 10_134.48,
  cumulativeInternalRebuyPrincipalEur: 10_134.48,
  internalRebuyOpenCostBasisEur: 9_950,
  internalRebuyCurrentMarketValueEur: 16_800,
  internalRebuyUnrealizedGainEur: 6_850,
  internalRebuyRealizedGainEur: 0,
  internalRebuyTotalReturnEur: 6_665.52,
  internalRebuyTotalReturnPct: 0.6577,
  internalRebuyUnitsOpen: 123.456,
  internalRebuyUnitsSold: 0,
  netProfitEur: 133_649.95,
  fiscalReserveEur: 1_721.68,
  eurcFreeEur: 2_271.05,
  eurCashEur: 0,
  annualReturnPct: 15.2,
  positions: {},
  events: [],
  forecastCoverage: "covered" as const,
};

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.cryptoControl = {
    persp2: {
      getSimulation: async () => ({
        ok: true as const,
        data: {
          computedAt: Date.UTC(2026, 5, 30),
          startYear: 2026,
          endYear: 2044,
          horizonDate: Date.UTC(2044, 11, 31),
          scenarios: ["conservador", "moderado", "base", "favorable", "optimista"].map((scenario) => ({
            scenario,
            label: scenario,
            annualSnapshots: [annualSnapshot],
            summary: {
              scenario,
              strategyEnabled: true,
              strategyMode: "INTELLIGENT_STRATEGY",
              strategySource: "intelligent_engine",
              simulationOnly: true,
              requiresUserConfirmation: true,
              realizedSalesEur: 0,
              realizedRebuysEur: 0,
              realizedTaxEur: 0,
              simulatedUserRuleSalesEur: 0,
              simulatedUserRuleRebuysEur: 0,
              simulatedUserRuleTaxEur: 0,
              simulatedStrategicSalesEur: 12_405.53,
              simulatedStrategicRebuysEur: 10_134.48,
              simulatedStrategicTaxEur: 1_721.68,
              proposedSalesEur: 12_405.53,
              proposedRebuysEur: 10_134.48,
              projectedEurcReserve: 2_271.05,
              projectedFiscalReserve: 1_721.68,
              decision: "intelligent_strategy",
              initialWealthEur: 540.38,
              finalNetWealthEur: 203_747.86,
              initialCapitalEur: 597.91,
              totalContributionsEur: 69_557.53,
              externalContributionsEur: 70_097.91,
              totalHistoricalCapitalEur: 597.91,
              totalExternalPurchasesEur: 70_097.91,
              reinvestedCapitalEur: 10_134.48,
              cumulativeDeployedCapitalEur: 80_232.40,
              internalRebuyPrincipalEur: 10_134.48,
              cumulativeInternalRebuyPrincipalEur: 10_134.48,
              internalRebuyOpenCostBasisEur: 9_950,
              internalRebuyCurrentMarketValueEur: 16_800,
              internalRebuyUnrealizedGainEur: 6_850,
              internalRebuyRealizedGainEur: 0,
              internalRebuyTotalReturnEur: 6_665.52,
              internalRebuyTotalReturnPct: 0.6577,
              internalRebuyUnitsOpen: 123.456,
              internalRebuyUnitsSold: 0,
              currentInvestedCapitalEur: 203_198.32,
              eurcOperatingLiquidityEur: 2_271.05,
              eurcFiscalReserveEur: 1_721.68,
              eurcSecurityReserveEur: 0,
              openCostBasisEur: 76_888.32,
              grossWealthEur: 205_469.54,
              netProfitEur: 133_649.95,
              totalMarketGainEur: 133_649.95,
              totalSalesEur: 12_405.53,
              totalRebuysEur: 10_134.48,
              totalCommissionsEur: 120,
              totalTaxEur: 1_721.68,
              totalEurcReinvestedEur: 10_134.48,
              totalNetEurcInflowEur: 12_405.53,
              initialEurcFreeEur: 0,
              initialEurcFiscalReserveEur: 0,
              finalEurcFreeEur: 2_271.05,
              finalFiscalReserveEur: 1_721.68,
              xirr: 0.138,
              twr: 0.152,
              twrCumulative: 12.767,
              twrAnnualized: 0.152,
              maxDrawdownPct: 0.214,
            },
            assetPriceInfo: {},
          })),
          validations: [],
          diagnostics: {
            engineIsNew: true,
            source: "test",
            engineVersion: "test",
            engineBuildHash: "test",
            engineGeneratedAt: Date.UTC(2026, 5, 30),
            negativeMonthCount: 0,
            negativeYearCount: 0,
            maxDrawdownPct: 0.214,
            hasBearPeriods: true,
          },
        },
      }),
    },
  } as unknown as Window["cryptoControl"];
});

describe("Perspectivas", () => {
  test("muestra recompras como resultado económico y evita etiquetas ambiguas duplicadas", async () => {
    renderWithQuery(<Perspectivas />);

    await waitFor(() => expect(screen.getByText("Valor inicial cartera")).toBeInTheDocument());

    expect(screen.getByText("Base de coste inicial")).toBeInTheDocument();
    expect(screen.getByText("Valor actual en criptomonedas")).toBeInTheDocument();
    expect(screen.getByText("Principal recomprado")).toBeInTheDocument();
    expect(screen.getByText("Ventas y liquidez")).toBeInTheDocument();
    expect(screen.getByText("Resultado de recompras")).toBeInTheDocument();
    expect(screen.getByText("EURC usado en recompras")).toBeInTheDocument();
    expect(screen.getByText("Valor actual recompras")).toBeInTheDocument();
    expect(screen.getByText("Resultado recompras")).toBeInTheDocument();
    expect(screen.getByText("EURC libre restante")).toBeInTheDocument();

    expect(screen.queryByText("Capital invertido actual")).not.toBeInTheDocument();
    expect(screen.queryByText("Capital reinvertido")).not.toBeInTheDocument();
    expect(screen.queryByText("Recompras simuladas")).not.toBeInTheDocument();
    expect(screen.queryByText("Reinversión EURC")).not.toBeInTheDocument();
  });
});
