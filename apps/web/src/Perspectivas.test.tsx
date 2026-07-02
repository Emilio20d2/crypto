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

const generatedAt = Date.UTC(2026, 5, 30);
const horizonDate = Date.UTC(2044, 11, 31);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.cryptoControl = {
    perspectivesV5: {
      getSimulation: async () => ({
        ok: true as const,
        data: {
          engineVersion: "perspectives-v5" as const,
          generatedAt,
          scenario: "base" as const,
          strategyMode: "INTELLIGENT_STRATEGY" as const,
          pathId: "test-path-base",
          monthlySnapshots: [{
            month: "2044-12",
            date: horizonDate,
            openingNetWealthEur: 100_000,
            closingGrossWealthEur: 205_469.54,
            closingNetWealthEur: 203_747.86,
            cryptoMarketValueEur: 203_198.32,
            operatingEurcEur: 2_271.05,
            fiscalReserveEur: 1_721.68,
            externalCapitalCumulativeEur: 70_097.91,
            internalRebuyCapitalCumulativeEur: 10_134.48,
            totalCapitalDeployedCumulativeEur: 80_232.39,
            realizedGainCumulativeEur: 12_405.53,
            unrealizedGainEur: 121_244.42,
            netProfitEur: 133_649.95,
            externalContributionsThisMonthEur: 6_000,
            marketResultThisMonthEur: 12_000,
            costsThisMonthEur: 120,
            taxesPaidThisMonthEur: 0,
          }],
          annualSnapshots: [{
            year: 2044,
            openingNetWealthEur: 100_000,
            closingGrossWealthEur: 205_469.54,
            closingNetWealthEur: 203_747.86,
            externalContributionsEur: 6_000,
            internalRebuyCapitalEur: 10_134.48,
            totalCapitalDeployedEur: 80_232.39,
            realizedGainEur: 12_405.53,
            unrealizedGainEur: 121_244.42,
            netProfitEur: 133_649.95,
            operatingEurcEur: 2_271.05,
            fiscalReserveEur: 1_721.68,
            partialSalesEur: 12_405.53,
            rebuysEur: 10_134.48,
          }],
          finalGrossWealthEur: 205_469.54,
          finalNetWealthEur: 203_747.86,
          externalCapitalEur: 70_097.91,
          internalRebuyCapitalEur: 10_134.48,
          totalCapitalDeployedEur: 80_232.39,
          realizedGainEur: 12_405.53,
          unrealizedGainEur: 121_244.42,
          netProfitEur: 133_649.95,
          validationErrors: [],
        },
      }),
    },
    perspectives: {
      getAnalystForecasts: async () => ({ ok: true as const, data: [] }),
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
