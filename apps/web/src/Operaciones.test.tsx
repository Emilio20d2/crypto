import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Operaciones } from "./pages/Operaciones";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mockAPI = () => {
  window.cryptoControl = {
    assets: {
      list: async () => ({
        ok: true as const,
        data: [
          { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto" as const, createdAt: 0, updatedAt: 0 },
          { id: "ETH", symbol: "ETH", name: "Ethereum", type: "crypto" as const, createdAt: 0, updatedAt: 0 }
        ]
      })
    },
    market: {
      getCurrentPrice: async () => ({ ok: true as const, data: { price: 50000, state: "live" as const, provider: "mock", fetchedAt: Date.now() } }),
      getHistoricalPrices: async () => ({ ok: true as const, data: { provider: "mock", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: Date.now(), isCached: false } })
    },
    portfolio: {
      getSummary: async () => ({ ok: true as const, data: { totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "complete" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null } }),
      getPositions: async () => ({ ok: true as const, data: {} }),
      getAllocation: async () => ({ ok: true as const, data: [] })
    },
    transactions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: { id: "test-id" } }),
      update: async () => ({ ok: true as const, data: null }),
      delete: async () => ({ ok: true as const, data: null })
    },
    settings: {
      get: async () => ({ ok: true as const, data: null }),
      update: async () => ({ ok: true as const, data: null })
    },
    coinbase: {
      importCredentialsFile: async () => ({ ok: true as const, data: { connected: false, canceled: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: false, canTrade: false, canTransfer: false } } }),
      connectFromJson: async () => ({ ok: true as const, data: { connected: true, keyDisplayName: "••••abcd", algorithm: "ES256" as const, permissions: { canView: true, canTrade: false, canTransfer: false } } }),
      connect: async () => ({ ok: true as const, data: { connected: true } }),
      disconnect: async () => ({ ok: true as const, data: null }),
      getStatus: async () => ({ ok: true as const, data: { connected: false, lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null } }),
      sync: async () => ({ ok: true as const, data: { itemsProcessed: 0, newTransactions: 0, skippedDuplicates: 0 } }),
    }
  };
};

beforeEach(mockAPI);

describe("Operaciones UI", () => {
  test("rechazar cantidades negativas mediante validación Zod", async () => {
    renderWithQuery(<Operaciones />);

    // Fill in only the amount field with a negative value and submit
    await act(async () => {
      const dateInput = screen.getByLabelText(/Fecha/i);
      fireEvent.change(dateInput, { target: { value: "2026-06-13T10:00" } });

      const amountInput = screen.getByLabelText(/^Cantidad/i);
      // Simulate entering a negative number
      fireEvent.change(amountInput, { target: { value: "-5", valueAsNumber: -5 } });

      const submitBtn = screen.getByText(/Guardar Operación/i);
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/La cantidad debe ser mayor a 0/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test("usa window.cryptoControl, no window.api", () => {
    expect(window.cryptoControl).toBeDefined();
    expect(window.cryptoControl.transactions).toBeDefined();
    expect(window.cryptoControl.settings).toBeDefined();
    expect((window as unknown as { api?: unknown }).api).toBeUndefined();
  });

  test("muestra historial vacío cuando no hay operaciones", async () => {
    renderWithQuery(<Operaciones />);
    await waitFor(() => {
      expect(screen.getByText(/Sin operaciones registradas/i)).toBeInTheDocument();
    });
  });
});
